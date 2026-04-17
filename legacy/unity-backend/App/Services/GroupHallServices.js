'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const groupHallModel = mongoose.model('groupHall');

module.exports = {
  getGroupHalls : async function (data,column) {
    try {
      return await groupHallModel.find(data).select(column);
    } catch (e) {
      console.log("Error", e);
    }
  },
  getGroupHall: async function (data, column) {
    try {
      return await groupHallModel.findOne(data).select(column);
    } catch (e) {
      console.log("Error", e);
    }
  },
  getByData: async function(data,select = {}) {
    try {
        return await groupHallModel.find(data).select(select);
    } catch (e) {
        console.log("HallServices Error in getByData", e);
        return new Error(e);
    }
  },
  getById: async function(id) {
      try {
          return await groupHallModel.findById(id);
      } catch (error) {
          console.log('HallServices Error in getById : ', error);
      }
  },

  getHallDatatable: async function(query, length, start, sort) {
      try {
          return await groupHallModel.find(query).skip(start).limit(length).sort(sort);
      } catch (e) {
          console.log("HallServices Error in getPlayerData", e);
          return new Error(e);
      }
  },

  getHallCount: async function(data) {
      try {
          return await groupHallModel.countDocuments(data);
      } catch (e) {
          console.log("HallServices Error in getAgentCount", e);
          return new Error(e);
      }
  },

  getSingleHallData: async function(data, column) {
      try {
          return await groupHallModel.findOne(data).select(column);
      } catch (e) {
          console.log("HallServices Error in getSingleHallData", e);
          return new Error(e);
      }
  },

  getSingleHall: async function(data) {
      try {
          return await groupHallModel.findOne(data);
      } catch (e) {
          console.log("HallServices Error in getSingleHall", e);
          return new Error(e);
      }
  },



  getAllHallDataSelect: async function(data, column) {
      try {
          return await groupHallModel.find(data).select(column);
      } catch (e) {
          console.log("HallServices Error in getAllHallDataSelect", e);
          return new Error(e);
      }
  },

  getHallSelectDatatable: async function(query, length, start, column) {
      try {
          if (length == -1) {
              return await groupHallModel.find(query).lean();
          } else {
              return await groupHallModel.find(query).skip(start).limit(length).select(column).lean();
          }
      } catch (e) {
          console.log("HallServices Error in getPlayerDataTable", e);
          return new Error(e);
      }
  },

  insertHallData: async function(data) {
      try {
          return await groupHallModel.create(data);
      } catch (e) {
          console.log("GroupHallServices Error in insertHallData", e);
          return new Error(e);
      }
  },

  deleteHall: async function(data) {
      try {
          return await groupHallModel.deleteOne({ _id: data });
      } catch (e) {
          console.log("HallServices Error in deletePlayer", e);
          return new Error(e);
      }
  },

  updateHallData: async function(condition, data) {
      try {
          return await groupHallModel.updateOne(condition, data);
      } catch (e) {
          console.log("HallServices Error in updatePlayerData", e);
          return new Error(e);
      }
  },
  updateManyData: async function(data) {
      try {
          return await groupHallModel.updateMany({}, {
              $pull: {
                  agents: { _id: data },
              }
          }, { multi: true });
      } catch (e) {
          console.log(" Error in updateManyData", e);
          return new Error(e);
      }
  },
  getLimitHall: async function(data) {
      try {
          return await groupHallModel.find(data).limit(8).sort({ createdAt: -1 });
      } catch (e) {
          console.log("HallServices Error in getLimitPlayer", e);
          return new Error(e);
      }
  },

  // getLimitedPlayerWithSort: async function(data, limit, sortBy, sortOrder) {
  //     try {
  //         return await groupHallModel.find(data).sort({ chips: sortOrder }).limit(limit);
  //     } catch (e) {
  //         console.log("HallServices Error in getLimitedPlayerWithSort", e);
  //         return new Error(e);
  //     }
  // },

  aggregateQuery: async function(data) {
      try {
          return await groupHallModel.aggregate(data);
      } catch (e) {
          console.log("HallServices Error in aggregateQuery", e);
          return new Error(e);
      }
  },

  // updateMultiplePlayerData: async function(condition, data) {
  //     try {
  //         await groupHallModel.update(condition, data, { multi: true });
  //     } catch (e) {
  //         console.log("HallServices Error in updateMultiplePlayerData", e);
  //         return new Error(e);
  //     }
  // },

  // getPlayerExport: async function(query, pageSize) {
  //     try {
  //         return await groupHallModel.find(query).limit(pageSize);
  //     } catch (e) {
  //         console.log("HallServices Error in getPlayerExport", e);
  //         return new Error(e);
  //     }
  // },

  // getLoggedInTokens: async function() {
  //     try {
  //         return await groupHallModel.find({ loginToken: { $ne: null } }).select({ loginToken: 1, _id: 0 });
  //     } catch (e) {
  //         console.log("Error", e);
  //         return new Error(e);
  //     }
  // },
  getGroupHallByData: async function(data) {
      try {
          return await groupHallModel.find(data);
      } catch (e) {
          console.log("HallServices Error in getGroupHallByData", e);
          return new Error(e);
      }
  },
  getGroupHallById: async function(id) {
      try {
          return await groupHallModel.findById(id);
      } catch (error) {
          console.log('HallServices Error in getById : ', error);
      }
  },

    getSingleGoh: async function (data, select, setOption) {
        try {
            return await groupHallModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleGoh:", e);
        }
    },

}