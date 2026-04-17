'use strict';

const mongoose = require('mongoose');
var Sys = require('../../../Boot/Sys');
const Model = mongoose.model('Chats');


module.exports = {

    insertData: async function(data) {
        try {
            return await Model.create(data);
        } catch (e) {
            console.log("Error", e);
            throw new Error('error in insertData' + e.message);
        }
    },
 
    getByData: async function(data, select, setOption) {
        try {
            return await Model.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

}