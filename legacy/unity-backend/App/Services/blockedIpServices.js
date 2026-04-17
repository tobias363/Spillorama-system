'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const blokedIpModel  = mongoose.model('blokedIp');


module.exports = {

	getByData: async function(data){
        try {
          return  await blokedIpModel.find(data);
        } catch (e) {
          console.log("Error",e);
        }
	},

	getIpDatatable: async function(query, length, start){
        try {
          return  await blokedIpModel.find(query).skip(start).limit(length);
        } catch (e) {
          console.log("Error",e);
        }
	},

	getIpData: async function(data){
		try {
			return  await blokedIpModel.findOne(data);
		} catch (e) {
			console.log("Error",e);
		}
	},

	getIpCount: async function(data){
	  try {
	        return  await blokedIpModel.countDocuments(data);
	      } catch (e) {
	        console.log("Error",e);
	  }
	},


	updateIpData: async function(condition, data){
		try {
			await blokedIpModel.updateMany(condition, data);
		} catch (e) {
			console.log("Error",e);
		}
	},

	insertIpData: async function(data){
		try {
			await blokedIpModel.create(data);
		} catch (e) {
			console.log("Error",e);
		}
	},

	deleteIp: async function(data){
        try {
          await blokedIpModel.deleteOne({_id: data});
        } catch (e) {
          console.log("Error",e);
        }
  },
}
