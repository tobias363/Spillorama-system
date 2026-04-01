const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SettingSchema = new Schema({
			defaultChips: {
				type: 'number',
				default: 0
				// required: true
			},
		 	rakePercenage: {
				type: 'number',
				default: 0
				// required: true
			},
			expireTime : {
				type: 'number',
				// required: true
			},
			maintenance:Schema.Types.Mixed,	
			BackupDetails:Schema.Types.Mixed,
			chipsBought: {
				type: 'number',
				default: 0,
			},
			withdrawLimit: {
				type: 'number',
				default: 0
			},
			amount: {
				type: 'number',
				default: 0
			},
			commission: {
				type: 'number',
				default: 0
			},
			processId: {
				type: 'number',
			    default: 0
			},
			android_version:{
				type: 'number',
				default: 0
			},
			ios_version:{
				type: 'number',
				default: 0
			},
			wind_linux_version:{
				type: 'number',
				default: 0
			},
			webgl_version:{
				type: 'number',
				default: 0
			},
			disable_store_link:{
				type: 'string',
			},
			android_store_link:{
				type: 'string'
			},
			ios_store_link:{
				type: 'string',
			},
			windows_store_link:{
				type: 'string'
			},
			webgl_store_link:{
				type: 'string'
			},
			multitable_status:{
				type: 'string',
			},
			systemChips: {
				type: 'number',
				default: 0
			},
			adminExtraRakePercentage:{
				type: 'number',
				default: 0
			},
			screenSaver:{
				type: Boolean, 
				default: false 
			},
			screenSaverTime:{
				type: 'string',
				default: '5'
			},
			imageTime:{
				type: 'array',
				default: []
			},
			systemInformationData:{
				type: String,
				default: ""
			},
			gameTicketCounts: {  // It will be used to store games latest count, now it is used for game 4
				type: Schema.Types.Mixed,
    			default: {}
			},
			daily_spending:{
				type: 'number',
				default: 0
			},
			monthly_spending:{
				type: 'number',
				default: 0
			},
	},{ collection: 'setting' });
mongoose.model('setting', SettingSchema);
 
