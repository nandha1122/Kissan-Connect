const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    content: { type: String, required: true },
    image: { type: String }, // Stores the filename of the crop photo
    language: { type: String, default: 'en' }, 
    category: { type: String }, // Technique category for searching
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', postSchema);