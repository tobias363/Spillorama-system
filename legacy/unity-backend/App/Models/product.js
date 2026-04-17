const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ProductSchema = new Schema({
  name: { type: 'string' },
  productId:{type:'string'},
  price: { type: 'number' },
  category: { type: Schema.Types.ObjectId, ref: 'category' },
  status: { type: 'string', default: "active" },
  productImage: { type: 'string', require: true},
  isDeleted: { type: Boolean, default: false }, //1 means deleted and 0 means not deleted
  createdBy:{type : mongoose.Schema.Types.ObjectId , required : true},
  adminProduct: {type : Boolean, default : true},
  createdAt: { type: Date, default: Date.now() },
  updatedAt: { type: Date, default: Date.now() },
}, { collection: 'product' });
mongoose.model('product', ProductSchema);