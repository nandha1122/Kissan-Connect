const User = require('../models/user');
const jwt = require('jsonwebtoken');

// 1. Mock OTP Request
exports.requestOTP = async (req, res) => {
    try {
        console.log(`[MOCK OTP] 1234 sent to ${req.body.mobile}`);
        res.status(200).json({ success: true, message: "OTP sent" });
    } catch (err) {
        res.status(500).json({ success: false });
    }
};

// 2. Verify OTP & Set 30-Day Cookie
exports.verifyOTP = async (req, res) => {
    try {
        const { mobile, name, otp } = req.body;
        if (otp !== "1234") return res.status(400).json({ message: "Wrong OTP" });

        // Upsert user (Update if exists, Create if not)
        let user = await User.findOneAndUpdate({ mobile }, { name }, { upsert: true, new: true });
        
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000, 
            sameSite: 'Lax',
            secure: false // Set to true if using HTTPS
        });
        res.status(200).json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false });
    }
};

// 3. Get Me (Stay Logged In Check)
exports.getMe = async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) return res.status(401).json({ success: false });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        res.status(200).json({ success: true, user });
    } catch (err) {
        res.status(401).json({ success: false });
    }
};

// 4. Logout (Clears Cookie)
exports.logout = (req, res) => {
    res.clearCookie('token');
    res.status(200).json({ success: true });
};