'use strict';

const mongoose = require('mongoose');
const Sys = require('../../Boot/Sys');
const schedulesModel = mongoose.model('schedules');
const dailySchedulesModel = mongoose.model('dailySchedule');
const assignedHallsModel = mongoose.model('assignedHalls');
const subGameScheduleModel = mongoose.model('subGameSchedule');
const agentRegisteredTicketModel = mongoose.model('agentRegisteredTicket');
const agentSellPhysicalTicketModel = mongoose.model('agentSellPhysicalTicket');
module.exports = {
    getSchedulesByData: async function (data, select, setOption) {
        try {
            return await schedulesModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getSchedulesBySelectData' + e.message);
        }
    },

    getSchedulesById: async function (id, select) {
        try {
            return await schedulesModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getSchedulesById : ', error);
        }
    },

    getSchedulesCount: async function (data) {
        try {
            return await schedulesModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleSchedulesData: async function (data, select, setOption) {
        try {
            return await schedulesModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleSchedulesData:", e);
        }
    },

    getSingleDailySchedulesData: async function (data, select, setOption) {
        try {
            return await dailySchedulesModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleDailySchedulesData:", e);
        }
    },

    getSchedulesDatatable: async function (query, length, start, sort) { //sort
        try {
            return await schedulesModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getSchedulesDatatable :", e);
        }
    },

    insertSchedulesData: async function (data) {
        try {
            return await schedulesModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteSchedule: async function (data) {
        try {
            return await schedulesModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateSchedulesData: async function (condition, data) {
        try {
            return await schedulesModel.findOneAndUpdate(condition, data, { new: true });
        } catch (e) {
            console.log("updateSchedulesData", e);
        }
    },

    aggregateQuerySchedules: async function (data) {
        try {
            return await schedulesModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQuerySchedules", e);
        }
    },

    //dailySchedulesModel
    getDailySchedulesByData: async function (data, select, setOption) {
        try {
            return await dailySchedulesModel.find(data, select, setOption).lean();  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getDailySchedulesByData' + e.message);
        }
    },

    getDailySchedulesById: async function (id, select) {
        try {
            return await dailySchedulesModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getDailySchedulesById : ', error);
        }
    },

    getDailySchedulesCount: async function (data) {
        try {
            return await dailySchedulesModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getDailySingleSchedulesData: async function (data, select, setOption) {
        try {
            return await dailySchedulesModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getDailySingleSchedulesData:", e);
        }
    },

    getDailySchedulesDatatable: async function (query, length, start, sort) { //sort
        try {
            return await dailySchedulesModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getDailySchedulesDatatable :", e);
        }
    },

    insertDailySchedulesData: async function (data) {
        try {
            return await dailySchedulesModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteDailySchedule: async function (data) {
        try {
            return await dailySchedulesModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateDailySchedulesData: async function (condition, data) {
        try {
            return await dailySchedulesModel.findOneAndUpdate(condition, data, { new: true });
        } catch (e) {
            console.log("updateDailySchedulesData", e);
        }
    },

    aggregateQueryDailySchedules: async function (data) {
        try {
            return await dailySchedulesModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQueryDailySchedules", e);
        }
    },

    // assigned halls
    getAssignedHallsByData: async function (data, select, setOption) {
        try {
            return await assignedHallsModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getAssignedHallsByData' + e.message);
        }
    },

    getAssignedHallsById: async function (id, select) {
        try {
            return await assignedHallsModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getAssignedHallsById : ', error);
        }
    },

    getAssignedHallsCount: async function (data) {
        try {
            return await assignedHallsModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleAssignedHallsData: async function (data, select, setOption) {
        try {
            return await assignedHallsModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleAssignedHallsData:", e);
        }
    },

    getAssignedHallsDatatable: async function (query, length, start, sort) { //sort
        try {
            return await assignedHallsModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getAssignedHallsDatatable :", e);
        }
    },

    insertAssignedHallsData: async function (data) {
        try {
            return await assignedHallsModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteAssignedHalls: async function (data) {
        try {
            return await assignedHallsModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateAssignedHallsData: async function (condition, data) {
        try {
            return await assignedHallsModel.findOneAndUpdate(condition, data, { new: true });
        } catch (e) {
            console.log("updateAssignedHallsData", e);
        }
    },

    aggregateQueryAssignedHalls: async function (data) {
        try {
            return await assignedHallsModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQueryAssignedHalls", e);
        }
    },

    // agent registered tickets
    getAgentRegisteredTicketByData: async function (data, select, setOption) {
        try {
            return await agentRegisteredTicketModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getAgentRegisteredTicketByData' + e.message);
        }
    },

    getAgentRegisteredTicketById: async function (id, select) {
        try {
            return await agentRegisteredTicketModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getAgentRegisteredTicketById : ', error);
        }
    },

    getAgentRegisteredTicketCount: async function (data) {
        try {
            return await agentRegisteredTicketModel.countDocuments(data);
        } catch (e) {
            console.log("Error in  getAgentRegisteredTicketCount", e);
        }
    },

    getSingleAgentRegisteredTicketData: async function (data, select, setOption) {
        try {
            return await agentRegisteredTicketModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleAgentRegisteredTicketData:", e);
        }
    },

    insertAgentRegisteredTicketData: async function (data) {
        try {
            return await agentRegisteredTicketModel.create(data);
        } catch (e) {
            console.log("Error in insertAgentRegisteredTicketData", e);
        }
    },

    deleteAgentRegisteredTicket: async function (data) {
        try {
            return await agentRegisteredTicketModel.deleteOne(data);
        } catch (e) {
            console.log("Error in deleteAgentRegisteredTicket", e);
        }
    },

    deleteManyAgentRegisteredTicket: async function (data) {
        try {
            return await agentRegisteredTicketModel.deleteMany(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateAgentRegisteredTicketData: async function (condition, query, filter) {
        try {
            let ticket = await agentRegisteredTicketModel.findOneAndUpdate(condition, query, filter);
            return ticket;
        } catch (e) {
            console.log("updateAgentRegisteredTicketData", e);
        }
    },

    updateManyAgentRegisteredTicketData: async function (condition, query, filter) {
        try {
            let ticket = await agentRegisteredTicketModel.findOneAndUpdate(condition, query, filter);
            return ticket;
        } catch (e) {
            console.log("updateAgentRegisteredTicketData", e);
        }
    },


    // agent selling tickets
    getAgentSellPhysicalTicketByData: async function (data, select, setOption) {
        try {
            return await agentSellPhysicalTicketModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getAgentSellPhysicalTicketByData' + e.message);
        }
    },

    getAgentSellPhysicalTicketById: async function (id, select) {
        try {
            return await agentSellPhysicalTicketModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getAgentSellPhysicalTicketById : ', error);
        }
    },

    getAgentSellPhysicalTicketCount: async function (data) {
        try {
            return await agentSellPhysicalTicketModel.countDocuments(data);
        } catch (e) {
            console.log("Error in  getAgentSellPhysicalTicketCount", e);
        }
    },

    getSingleAgentSellPhysicalTicketData: async function (data, select, setOption) {
        try {
            return await agentSellPhysicalTicketModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleAgentSellPhysicalTicketData:", e);
        }
    },

    insertAgentSellPhysicalTicketData: async function (data) {
        try {
            return await agentSellPhysicalTicketModel.create(data);
        } catch (e) {
            console.log("Error in insertAgentSellPhysicalTicketData", e);
        }
    },

    deleteAgentSellPhysicalTicket: async function (data) {
        try {
            return await agentSellPhysicalTicketModel.deleteOne(data);
        } catch (e) {
            console.log("Error in deleteAgentSellPhysicalTicket", e);
        }
    },

    deleteManyAgentSellPhysicalTicket: async function (data) {
        try {
            return await agentSellPhysicalTicketModel.deleteMany(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateAgentSellPhysicalTicketData: async function (condition, query, filter) {
        try {
            let ticket = await agentSellPhysicalTicketModel.findOneAndUpdate(condition, query, filter);
            return ticket;
        } catch (e) {
            console.log("Error in updateAgentSellPhysicalTicketData", e);
        }
    },

    getsubGamesScheduleData: async function (data, select, setOption) {
        try {
            return await subGameScheduleModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getsubGamesScheduleData", e);
            return null;
        }
    },

    insertSubGamesScheduleData: async function (data) {
        try {
            return await subGameScheduleModel.create(data);
        } catch (e) {
            console.log("Error in insertSubGamesScheduleData", e);
            return null;
        }
    },

    updateSubGamesScheduleData: async function (condition, data) {
        try {
            return await subGameScheduleModel.findOneAndUpdate(condition, data, { new: true });
        } catch (e) {
            console.log("Error in updateSubGamesScheduleData", e);
            return null;
        }
    },

    getStoredSubGames: async function (data, select, setOption) {
        try {
            return await subGameScheduleModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getStoredSubGames", e);
            return null;
        }
    }
}