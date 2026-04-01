'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const categoryModel = mongoose.model('category');

module.exports = {
  getByData: async function (data,select = {}) {
    console.log('Find By Data:', data)
    try {
      return await categoryModel.find(data, select);
    } catch (e) {
      console.log("CategoryServices Error in getByData", e);
      return new Error(e);
    }
  },
  getOneByData: async function (data,select = {}) {
    console.log('getOneByData By Data:', data)
    try {
      return await categoryModel.findOne(data);
    } catch (e) {
      console.log("CategoryServices Error in getOneByData", e);
      return new Error(e);
    }
  },
  insertCategoryData: async function (data) {
    try {
      data.categoryId = 'CT' + (await categoryModel.countDocuments({}) + 1000);
      console.log("UniqId for category", data.categoryId)
      return await categoryModel.create(data);
    } catch (e) {
      console.log("CategoryServices Error in insertCategoryData", e);
      return new Error(e);
    }
  },
  getCategoryDatatable: async function (query, length, start, sort) {
    try {
      return await categoryModel.find(query).skip(start).limit(length).sort(sort);
    } catch (e) {
      console.log("CategoryServices Error in getCategoryDataTable", e);
      return new Error(e);
    }
  },
  getCategoryCount: async function (data) {
    try {
      return await categoryModel.countDocuments(data);
    } catch (e) {
      console.log("PlayerServices Error in getCategoryCount", e);
      return new Error(e);
    }
  },
  updateCategory: async function (condition, data) {
    try {
      let response = await categoryModel.findOneAndUpdate(condition, data, { new: true, useFindAndModify: false });
      return response;
    } catch (e) {
      console.log("Error", e);
      return false;
    }
  },
  deleteCategory: async function (data) {
    try {
      return await categoryModel.deleteOne({ _id: data });
    } catch (e) {
      console.log("CategoryServices Error in deleteCategory", e);
      return new Error(e);
    }
  },
}