const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const blokedIpSchema = new Schema({
	
	ip: {
		type: 'string',
		
	},
	status: {
		type: 'string',
		default: ''
	},
	flag: {
		type: 'string',
		default: ''
		// required: true
	},
	
	createdAt : { type: Date, default: Date.now() },
	updatedAt : { type: Date, default: Date.now() },
	
},{ collection: 'blokedIp' });
mongoose.model('blokedIp', blokedIpSchema);
