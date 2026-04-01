var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var mongoose = require('mongoose');
module.exports = {
    leaderboardView: async function (req, res) {
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
                // let stringReplace = user.permission['Leaderboard Management'] || [];
                let stringReplace =req.session.details.isPermission['Leaderboard Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

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
                "leaderboard_points_table",
                "leaderboard",
                "add_leaderboard",
                "place",
                "points",
                "action",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_leaderboard_place",
                "delete_button",
                "cancel_button",
                "deleted",
                "cancelled",
                "your_imaginary_file_has_been_deleted",
                "learderboard_palce_deleted_successfully",
                "leaderboard_place_not_deleted",
                "show",
                "entries",
                "previous",
                "next",
                "search"
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                leaderboardActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                leaderboard: translate,
                navigation: translate

            };

            return res.render('LeaderboardManagement/leaderboard', data);
        } catch (e) {
            console.log("Error in leaderboardView", e);
            return new Error(e);
        }
    },

    getLeaderboard: async function (req, res) {

        // res.send(req.query.start); return false;
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
                query = { place: { $regex: '.*' + search + '.*' } };
            }


            // let startTo = new Date(req.query.start_date);
            // let endFrom = new Date(req.query.end_date);
            // endFrom.setHours(23, 59, 59);

            // if (req.query.is_date_search == "yes" && search == '') {
            //     query = { createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            // if (req.query.is_date_search == "yes" && search != '') {
            //     query = { fullName: { $regex: '.*' + search + '.*' }, createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            //console.log(query);
            let reqCount = await Sys.App.Services.LeaderboardServices.getLeaderboardCount(query);

            let data = await Sys.App.Services.LeaderboardServices.getLeaderboardDatatable(query, length, start, sort);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            //console.log("data:::::::::::::", data)

            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addLeaderboard: async function (req, res) {
        try {
            let key = [
                "leaderboard_table",
                "dashboard",
                "leaderboard",
                "edit_leaderboard_point",
                "add_leaderboard",
                "edit_leaderboard_place",
                "place",
                "points",
                "submit",
                "cancel",
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            var optionField = [
                '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11-20', '21-40', '41-60', '61-80', '81-100'
            ]

            let leaderboard = await Sys.App.Services.LeaderboardServices.getByData({});

            var disabledOptionField = [];
            for (var i = 0; i < leaderboard.length; i++) {
                disabledOptionField += leaderboard[i].place
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                leaderboardActive: 'active',
                optionField: optionField,
                disabledOptionField: disabledOptionField,
                translate: translate,
                navigation: translate
            };
            return res.render('LeaderboardManagement/leaderboardAdd', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addLeaderboardPostData: async function (req, res) {
        try {
            //console.log("addLeaderboardPostData", req.body);


            let leaderboard = await Sys.App.Services.LeaderboardServices.insertLeaderboardData({
                place: req.body.place,
                points: req.body.points
            });

            if (!leaderboard) {
                // req.flash('error', 'Leaderboard Place Not Created');
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["leaderboard_place_not_created"], req.session.details.language));
                return res.redirect('/leaderboard');
            } else {
                // req.flash('success', 'Leaderboard Place create successfully');
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["leaderboard_place_created"], req.session.details.language));
                return res.redirect('/leaderboard');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    editLeaderboard: async function (req, res) {
        try {
            let key = [
                "leaderboard_table",
                "dashboard",
                "leaderboard",
                "edit_leaderboard_point",
                "add_leaderboard",
                "edit_leaderboard_place",
                "place",
                "points",
                "submit",
                "cancel",
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(key, req.session.details.language)

            let leaderboard = await Sys.App.Services.LeaderboardServices.getSingleLeaderboardData({ _id: req.params.id });

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                leaderboardActive: 'active',
                leaderboard: leaderboard,
                translate: translate,
                navigation: translate
            };
            return res.render('LeaderboardManagement/leaderboardAdd', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editLeaderboardPostData: async function (req, res) {
        try {
            //console.log("editLeaderboardPostData", req.body);

            let leaderboard = await Sys.App.Services.LeaderboardServices.getSingleLeaderboardData({ _id: req.params.id });

            if (!leaderboard) {
                // req.flash('error', 'No Leaderboard Place found');
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["leaderboard_not_found"], req.session.details.language));
                return res.redirect('/leaderboard');
            }


            let data = {
                place: req.body.place,
                points: req.body.points
            }

            await Sys.App.Services.LeaderboardServices.updateLeaderboardData({ _id: req.params.id }, data)

            // req.flash('success', 'Leaderboard Place updated successfully');
            req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["leaderboard_place_update_successfully"], req.session.details.language));
            return res.redirect('/leaderboard');

        } catch (e) {
            console.log("Error", e);
        }
    },


    getLeaderboardDelete: async function (req, res) {
        try {
            let player = await Sys.App.Services.LeaderboardServices.getSingleLeaderboardData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.LeaderboardServices.deleteLeaderboard(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

}