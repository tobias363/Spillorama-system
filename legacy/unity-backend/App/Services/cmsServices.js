'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const cmsModel = mongoose.model('cms');
const faqModel = mongoose.model('faq');


module.exports = {

    faqGetByData: async function(data) {
        try {
            return await faqModel.find(data);
        } catch (e) {
            console.log("CMSServices Error in faqGetByData", e);
            return new Error(e);
        }
    },
    faqGetById: async function(id) {
        try {
            return await faqModel.findById(id);
        } catch (error) {
            console.log('CMSServices Error in faqGetById : ', error);
        }
    },

    faqGetDatatable: async function(query, length, start, sort) {
        try {
            return await faqModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("CMSServices Error in faqGetDatatable", e);
            return new Error(e);
        }
    },

    faqGetCount: async function(data) {
        try {
            return await faqModel.countDocuments(data);
        } catch (e) {
            console.log("CMSServices Error in faqGetCount", e);
            return new Error(e);
        }
    },

    faqGetSingleData: async function(data, column) {
        try {
            return await faqModel.findOne(data);
        } catch (e) {
            console.log("CMSServices Error in faqGetSingleData", e);
            return new Error(e);
        }
    },

    faqInsertData: async function(data) {
        try {

            return await faqModel.create(data);
        } catch (e) {
            console.log("CMSServices Error in faqInsertData", e);
            return new Error(e);
        }
    },

    faqDelete: async function(data) {
        try {
            return await faqModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("CMSServices Error in faqDelete", e);
            return new Error(e);
        }
    },

    faqUpdateData: async function(condition, data) {
        try {
            return await faqModel.updateOne(condition, data);
        } catch (e) {
            console.log("CMSServices Error in faqUpdateData", e);
            return new Error(e);
        }
    },




    getByData: async function(data) {
        try {
            return await cmsModel.find(data);
        } catch (e) {
            console.log("CMSServices Error in getByData", e);
            return new Error(e);
        }
    },


    insertData: async function(data) {
        try {

            return await cmsModel.create(data);
        } catch (e) {
            console.log("CMSServices Error in TermInsertData", e);
            return new Error(e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await cmsModel.updateOne(condition, data);
        } catch (e) {
            console.log("CMSServices Error in updateData", e);
            return new Error(e);
        }
    },

    getSingleSelectedByData: async function(data, select, setOption) {
        try {
            return await cmsModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("CMSServices Error in getByData", e);
            return new Error(e);
        }
    },
}