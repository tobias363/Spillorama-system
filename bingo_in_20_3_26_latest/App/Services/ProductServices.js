'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const productModel = mongoose.model('product');
const productCartModel = mongoose.model('productCart');
module.exports = {
  getByData: async function (query, length, start, sort, opt = null) {
    console.log('Find By Data:', query);
    try {
      // return await productModel.find(data).populate("category",{_id:1,name:1});
      return await productModel.find(query).skip(start).limit(length).sort(sort).populate("category", opt);   
      //.exec(function (err,result) {console.log("error or result", err, result);return result;});
      
    } catch (e) {
      console.log("ProductServices Error in getByData", e);
      return new Error(e);
    }
  },
  getFindOneByData: async function (query) {
    console.log('getFindOneByData By Data:', query);
    try {
      return await productModel.findOne(query);
    } catch (e) {
      console.log("ProductServices Error in getByData", e);
      return new Error(e);
    }
  },
  insertProductData: async function (data) {
    try {
      data.productId = 'PD' + (await productModel.countDocuments({}) + 1000);
      console.log("UniqId for Product", data.productId)
      return await productModel.create(data);
    } catch (e) {
      console.log("ProductServices Error in insertProductData", e);
      return new Error(e);
    }
  },
  getProductCount: async function (data) {
    try {
      return await productModel.countDocuments(data);
    } catch (e) {
      console.log("PlayerServices Error in getPlayerCount", e);
      return new Error(e);
    }
  },
  updateProduct: async function (condition, data) {
    try {
      let response = await productModel.findOneAndUpdate(condition, data, { new: true, useFindAndModify :false});
      return response;
    } catch (e) {
      console.log("Error", e);
      return false;
    }
  },
  deleteProduct: async function (data) {
    try {
      return await productModel.deleteOne({ _id: data });
    } catch (e) {
      console.log("ProductServices Error in deleteProduct", e);
      return new Error(e);
    }
  },

  getCartByData: async function (query, length, start, sort) {
    console.log('Find By Data:', query);
    try {
      return await productCartModel.find(query).skip(start).limit(length).sort(sort);
    } catch (e) {
      console.log("ProductServices Error in getByData", e);
      return new Error(e);
    }
  },

  getCartAggregationData: async function (query) {
    try {
      return await productCartModel.aggregate(query);
    } catch (e) {
      console.log("ProductServices Error in getCartAggregationData", e);
      throw new Error(e);
    }
  },

  getFindOneCartByData: async function (query) {
    console.log('getFindOneByData By Data:', query);
    try {
      return await productCartModel.findOne(query);
    } catch (e) {
      console.log("ProductServices Error in getByData", e);
      return new Error(e);
    }
  },
  insertProductCartData: async function (data) {
    try {
      data.productId = 'PD' + (await productCartModel.countDocuments({}) + 1000);
      console.log("UniqId for Product", data.productId)
      return await productCartModel.create(data);
    } catch (e) {
      console.log("ProductServices Error in insertProductData", e);
      return new Error(e);
    }
  },
  getProductCartCount: async function (data) {
    try {
      return await productCartModel.countDocuments(data);
    } catch (e) {
      console.log("PlayerServices Error in getPlayerCount", e);
      return new Error(e);
    }
  },
  updateProductCart: async function (condition, data) {
    try {
      let response = await productCartModel.findOneAndUpdate(condition, data, { new: true, useFindAndModify: false });
      return response;
    } catch (e) {
      console.log("Error", e);
      return new Error(e);
    }
  },
  deleteProductCart: async function (data) {
    try {
      return await productCartModel.deleteOne({ _id: data });
    } catch (e) {
      console.log("ProductServices Error in deleteProduct", e);
      return new Error(e);
    }
  },
}