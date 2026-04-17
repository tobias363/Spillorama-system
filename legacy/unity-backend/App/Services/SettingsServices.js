'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const settingsModel  = mongoose.model('setting');


module.exports = {


	getSettingsData: async function(data){
    try {
      return await settingsModel.findOne(data);
    } catch (e) {
      console.log("Error", e);
      return new Error(e);
    }
	 },

  getByData: async function(data){
        try {
          return  await settingsModel.find(data);
        } catch (e) {
          console.log("Error",e);
        }
  },

  updateSettingsData: async function(condition, data){
        try {
         return await settingsModel.updateOne(condition, data);
        } catch (e) {
          console.log("Error",e);
        }
  },

  insertSettingsData: async function(data){
        try {
          await settingsModel.create(data);
        } catch (e) {
          console.log("Error",e);
        }
  },

  findOneAndUpdateSettingsData: async function(condition, query, filter){
    try {
     return await settingsModel.findOneAndUpdate(condition, query, filter).lean();
    } catch (e) {
      console.log("Error",e);
    }
  },


}
