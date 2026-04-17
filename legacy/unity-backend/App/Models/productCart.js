const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const agentSellPhysicalTicketSchema = new Schema({
  orderId : {type : String},
  hallName: { type: String },
  hallId: { type: Schema.Types.ObjectId, ref: 'hall' },
  groupHallName: { type: String },
  groupHallId: { type: Schema.Types.ObjectId, ref: 'groupHall' },
  agentId: { type: Schema.Types.ObjectId, ref: 'agent' },
  shiftId: { type: Schema.Types.ObjectId },
  productList: { type: Array, required: true },
  userType: { type: String, required: true },
  userName: { type: String },
  agentName: { type: String },
  userId: { type: Schema.Types.ObjectId },
  status: { type: String, required: true },
  totalAmount : {type : Number, required : true},
  paymentMethod : {type : String},
  orderPlaced : {type : Boolean, default : false},
  updatedAt: { type: Date, default: new Date()},
  createdAt: { type: Date, default: new Date() }
}, { collection: 'productCart', versionKey: false });
mongoose.model('productCart', agentSellPhysicalTicketSchema);