const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const auth = require('./controllers/authController');
const Post = require('./models/Post');
const Message = require('./models/Message');
const User = require('./models/user');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: 'http://localhost:3000', credentials: true }
});

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose.connect(process.env.MONGO_URI).then(() => console.log("Kissan Connect DB Connected"));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/request-otp', auth.requestOTP);
app.post('/api/auth/verify-otp', auth.verifyOTP);
app.get('/api/auth/me', auth.getMe);
app.post('/api/auth/logout', auth.logout);

// ─── Post Routes ──────────────────────────────────────────────────────────────
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, posts });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/posts/create', upload.single('image'), async (req, res) => {
    try {
        const { content, username, user } = req.body;
        const newPost = new Post({ content, username, userId: user, image: req.file ? req.file.filename : null });
        await newPost.save();
        res.status(201).json({ success: true, post: newPost });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ─── User Routes ──────────────────────────────────────────────────────────────

// Get all users
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name mobile followers following');
        res.json({ success: true, users });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Get single user profile by username
app.get('/api/users/:username', async (req, res) => {
    try {
        const user = await User.findOne({ name: req.params.username }, 'name mobile followers following');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Follow / Unfollow a user
app.post('/api/users/follow', async (req, res) => {
    try {
        const { followerUsername, targetUsername } = req.body;

        if (followerUsername === targetUsername) {
            return res.status(400).json({ success: false, message: "Cannot follow yourself" });
        }

        const follower = await User.findOne({ name: followerUsername });
        const target = await User.findOne({ name: targetUsername });

        if (!follower || !target) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const isAlreadyFollowing = follower.following.includes(targetUsername);

        if (isAlreadyFollowing) {
            // Unfollow
            follower.following = follower.following.filter(u => u !== targetUsername);
            target.followers = target.followers.filter(u => u !== followerUsername);
            await follower.save();
            await target.save();

            res.json({
                success: true,
                action: 'unfollowed',
                followerCount: target.followers.length,
                followingCount: follower.following.length
            });
        } else {
            // Follow
            follower.following.push(targetUsername);
            target.followers.push(followerUsername);
            await follower.save();
            await target.save();

            // Send real-time notification to the target user
            io.to(targetUsername).emit('newFollower', {
                from: followerUsername,
                message: `${followerUsername} started following you!`
            });

            res.json({
                success: true,
                action: 'followed',
                followerCount: target.followers.length,
                followingCount: follower.following.length
            });
        }
    } catch (err) {
        console.error("Follow error:", err);
        res.status(500).json({ success: false });
    }
});

// ─── Messaging Routes ─────────────────────────────────────────────────────────

// Get conversation between two users
app.get('/api/messages/:sender/:receiver', async (req, res) => {
    try {
        const { sender, receiver } = req.params;
        const messages = await Message.find({
            $or: [
                { sender, receiver },
                { sender: receiver, receiver: sender }
            ]
        }).sort({ createdAt: 1 });
        await Message.updateMany({ sender: receiver, receiver: sender, read: false }, { read: true });
        res.json({ success: true, messages });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Get unread message count
app.get('/api/messages/unread/:username', async (req, res) => {
    try {
        const count = await Message.countDocuments({ receiver: req.params.username, read: false });
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Send message
app.post('/api/messages/send', upload.single('image'), async (req, res) => {
    try {
        const { sender, receiver, text } = req.body;
        const message = new Message({
            sender, receiver, text,
            image: req.file ? req.file.filename : null
        });
        await message.save();
        io.to(receiver).emit('newMessage', message);
        res.json({ success: true, message });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ─── AI Routes ────────────────────────────────────────────────────────────────
app.post('/api/ai/translate', async (req, res) => {
    const { text, targetLang } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: `You are a translator. Translate the text below to ${targetLang}. Return ONLY the translated sentence. No explanations, no bullet points, no romanization, no options. Only the ${targetLang} sentence.\n\nText: ${text}\n\nTranslation:` }] }]
        });
        let raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        let lines = raw.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed !== '' && !trimmed.startsWith('*') && !trimmed.startsWith('-') && !trimmed.startsWith('(') && !trimmed.toLowerCase().startsWith('option');
        });
        let translatedText = lines[0]?.trim() || "";
        if (!translatedText) return res.status(500).json({ success: false, message: "Empty response" });
        res.json({ success: true, translatedText });
    } catch (err) {
        console.error("Translate Error:", err.response?.data || err.message);
        res.status(500).json({ success: false, message: "Translation Failed" });
    }
});

app.post('/api/ai/chat', async (req, res) => {
    const { question, language } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const replyLang = language || 'English';
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: `You are a helpful farming assistant for Indian farmers. Answer in ${replyLang}. Keep your answer very short, simple, and practical — maximum 3 sentences. No bullet points, no long explanations. Just a direct helpful answer a farmer can understand.\n\nQuestion: ${question}\n\nAnswer:` }] }]
        });
        const answer = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!answer) return res.status(500).json({ success: false, message: "Empty response" });
        res.json({ success: true, answer });
    } catch (err) {
        console.error("AI Error:", err.response?.data || err.message);
        res.status(500).json({ success: false, message: "AI Assistant Offline" });
    }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (username) => {
        socket.join(username);
        console.log(`${username} joined their room`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(5000, () => console.log("Server running on port 5000"));