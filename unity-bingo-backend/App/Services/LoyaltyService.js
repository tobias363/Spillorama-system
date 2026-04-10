'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const loyaltyModel = mongoose.model('loyalty');
module.exports = {

    getLoyaltyCount: async function(data) {
        try {
            return await loyaltyModel.countDocuments(data);
        } catch (e) {
            console.log("Error getLoyaltyCount", e);
        }
    },

    getLoyaltyDatatable: async function(query, length, start, sort) {
        try {
            return await loyaltyModel.find(query).skip(start).limit(length).sort(sort);;
        } catch (e) {
            console.log("Error getLoyaltyDatatable", e);
        }
    },
    getLoyaltyById: async function(id) {
        try {
            return await loyaltyModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in getById : ', error);
        }
    },


    deleteLoyalty: async function(data) {
        try {
            return await loyaltyModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("AgentServices Error in deletePlayer", e);
            return new Error(e);
        }
    },
    updateOneLoyalty: async function(condition, data) {
        try {
            return await loyaltyModel.updateOne(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    insertLoyaltyData: async function(data) {
        try {
            return await loyaltyModel.create(data);
        } catch (e) {
            console.log("Error insertLoyaltyData", e);
        }
    },

    getByDataLoyalty: async function(data) {
        try {
            return await loyaltyModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getByFindOne: async function(data) {
        try {
            return await loyaltyModel.findOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getByDataSortLoyalty: async function(data) {
        try {
            return await loyaltyModel.find(data).sort({ type: 1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getByIdLoyalty: async function(id) {
        try {
            return await loyaltyModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in loyaltyModel : ', error);
        }
    },

    getByIdLoyaltyValidation: async function(id) {
        try {
            return await loyaltyModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in loyaltyModel : ', error);
        }
    },

}