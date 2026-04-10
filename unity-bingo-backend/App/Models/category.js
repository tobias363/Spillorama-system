const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const CategorySchema = new Schema({
  name: { type: 'string' },
  categoryId: { type: 'string' },
  status: { type: 'string', default: "active" },
  isDeleted: { type: Boolean, default: false }, //1 means deleted and 0 means not deleted
  createdAt: { type: Date, default: Date.now() },
  updatedAt: { type: Date, default: Date.now() },
}, { collection: 'category' });
mongoose.model('category', CategorySchema);