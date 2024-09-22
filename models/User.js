const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
  uuid: { type: String, default: uuidv4, unique: true },
  telegram_id: { type: Number, required: true, unique: true },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);