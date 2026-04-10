var Sys = require('../../Boot/Sys');
const redisClient = require('../../Config/Redis');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');
module.exports = {

    // [ Loyalty Type ]
    loyalty: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Loyalty Management'] || [];
                let stringReplace =req.session.details.isPermission['Loyalty Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Loyalty Management'];
                if (stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
                if (stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
            }
            let key = [
                "loyalty_table",
                "loyalty",
                "dashboard",
                "translate",
                "add_loyalty",
                "loyalty_type",
                "points",
                "action",
                "are_you_sure",
                "you_will_not_abel_to_recover_this_page",
                "yes_delete",
                "no_cancle",
                "your_imaginary_file_has_been_deleted",
                "deleted",
                "loyalty_deleted",
                "cancelled",
                "loyalty_not_deleted",
                "loyalty_name",
                "search",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                session: req.session.details,
                success: req.flash("success"),
                loyaltyActive: 'active',
                myloyaltyManagementActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                translate,
                navigation: translate
            };

            let isDefaultLoyalty = await Sys.App.Services.LoyaltyService.getByDataLoyalty({});
            if (!isDefaultLoyalty || isDefaultLoyalty.length == 0) {
                await Sys.App.Services.LoyaltyService.insertLoyaltyData({
                    name: "Birthday",
                    points: 100,
                    slug: "birthday",
                    ltime: ''

                });

                await Sys.App.Services.LoyaltyService.insertLoyaltyData({
                    name: "Daily Attendance",
                    points: 100,
                    slug: "dailyAttendance",
                    ltime: ''
                });

            }

            return res.render('loyalty/list', data);
        } catch (error) {
            Sys.Log.error('Error in loyalty: ', error);
            return new Error(error);
        }
    },

    getLoyalty: async function (req, res) {
        try {
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                query = { name: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.LoyaltyService.getLoyaltyCount(query);

            let data = await Sys.App.Services.LoyaltyService.getLoyaltyDatatable(query, length, start, sort);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addLoyalty: async function (req, res) {
        try {
            let key = [
                "add_loyalty",
                "dashboard",
                "Loyalty",
                "edit_loyalty",
                "loyalty_name",
                "date_and_time",
                "points",
                "Cancel",
                "submit"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                loyaltyActive: 'active',
                translate,
                navigation: translate
            };

            return res.render('loyalty/add', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    addLoyaltyPostData: async function (req, res) {
        try {
            console.log('pattern: ', req.body);
            let fileName = '';
            let game = await Sys.App.Services.LoyaltyService.insertLoyaltyData({
                name: req.body.name,
                points: req.body.points,
                ltime: new Date(req.body.ltime)
            });
            // req.flash('success', 'Loyalty create successfully');
            req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["loyalty_create"], req.session.details.language));
            return res.redirect('/loyalty');
        } catch (e) {
            console.log("Error", e);
        }
    },

    editLoyalty: async function (req, res) {
        try {

            let key = [
                "add_loyalty",
                "dashboard",
                "Loyalty",
                "edit_loyalty",
                "loyalty_name",
                "date_and_time",
                "points",
                "Cancel",
                "submit"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            let query = { _id: req.params.id };
            let loyalty = await Sys.App.Services.LoyaltyService.getLoyaltyById(query);

            var ltime = dateTimeFunction(loyalty.ltime);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                loyaltyActive: 'active',
                loyalty: loyalty,
                ltime: ltime,
                translate,
                navigation: translate
            };
            return res.render('loyalty/add', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editLoyaltyPostData: async function (req, res) {
        try {
            let UpdateLoyaltyTwo = await Sys.App.Services.LoyaltyService.getLoyaltyById({ _id: req.params.id });
            console.log('pattern: ', req.body);
            console.log('UpdateLoyaltyTwo: ', UpdateLoyaltyTwo);
            if (UpdateLoyaltyTwo != undefined) {

                let game = await Sys.App.Services.LoyaltyService.updateOneLoyalty({
                    _id: req.params.id
                }, {
                    name: req.body.name,
                    points: req.body.points,
                    ltime: new Date(req.body.ltime)
                });
                // req.flash('success', 'Loyalty Updated successfully');
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["loyalty_updated"], req.session.details.language));
                return res.redirect('/loyalty');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    loyaltyDelete: async function (req, res) {
        try {
            let game = await Sys.App.Services.LoyaltyService.getLoyaltyById({ _id: req.body.id });
            if (game || game.length > 0) {
                await Sys.App.Services.LoyaltyService.deleteLoyalty(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    loyaltyManagement: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Loyalty Management'] || [];
                let stringReplace =req.session.details.isPermission['Loyalty Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Loyalty Management'];
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let key = [
                "loyalty_management",
                "dashboard",
                "emailId",
                "mobile_number",
                "firstname",
                "loyalty_points",
                "action",
                "search",
                "username",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                session: req.session.details,
                success: req.flash("success"),
                loyaltyManagementActive: 'active',
                myloyaltyManagementActive: 'active',
                viewFlag: viewFlag,
                loyalty: translate,
                navigation: translate
            };
            return res.render('loyalty/playerLoyalty', data);
        } catch (error) {
            Sys.Log.error('Error in loyalty: ', error);
            return new Error(error);
        }
    },

    getPlayerLoyalty: async function (req, res) {
        try {
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                query = { username: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);

            let data = await Sys.App.Services.PlayerServices.getPlayerDatatableNew(query, length, start, sort);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewLoyaltyPlayer: async function (req, res) {
        try {
            let key = [
                "view_player_loyalty",
                "dashboard",
                "loyalty_management",
                "username",
                "emailId",
                "mobile_number",
                "firstname",
                "loyalty_point_amount",
                "cancel",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            let query = {
                _id: req.params.id
            };
            let dataWallet = await Sys.App.Services.PlayerServices.getById(query);
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                loyaltyManagementActive: 'active',
                loyalty: dataWallet,
                loyaltyV: translate,
                navigation: translate
            };
            return res.render('loyalty/viewPlayer', data);
        } catch (e) {
            console.log("Error", e);
        }
    }

}