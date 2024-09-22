const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const messageSchema = new mongoose.Schema({
  uuid: { type: String, unique: true },
  id: { type: Number, required: true },
  ownuuid: { type: String, required: true },
  message: { type: String, required: true },
  joins: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);