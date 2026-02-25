const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    mobile: { type: String, required: true, unique: true },
    followers: [{ type: String }],   // array of usernames who follow this user
    following: [{ type: String }],   // array of usernames this user follows
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);