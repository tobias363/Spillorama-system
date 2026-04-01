var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var mongoose = require('mongoose');
const { json } = require('express');
module.exports = {
    groupHallView: async function (req, res) {
        try {
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Group Of Halls Management'] || [];
                let stringReplace =req.session.details.isPermission['Group Of Halls Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Hall Management'];

                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

            }

            let keys = [
                "group_of_halls",
                "dashboard",
                "group_of_id",
                "group_of_name",
                "number_of_hall_assigned",
                "tv_screen_url",
                "status",
                "action",
                "delete_message",
                "delete_player_message",
                "delete_button",
                "cancel_button",
                "deleted",
                "group_hall_delete",
                "cancelled",
                "group_hall_not_delete",
                "search",
                "show",
                "entries",
                "previous",
                "next",
                "result",
                "create_group_of_halls"
            ]


            let grouphallData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                groupHallActive: 'active',
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                viewFlag: viewFlag,
                grouphallData: grouphallData,
                navigation: grouphallData
            };

            if (viewFlag == true) {
                return res.render('GroupHall/groupHallManagement', data);
            } else {
                req.flash('error', 'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in hallView", e);
            return new Error(e);
        }
    },

    getGroupHall: async function (req, res) {
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
                query = { $or: [{ groupHallId: { $regex: '.*' + search + '.*' } }, { name: { $regex: '.*' + search + '.*', $options: 'i' } }] }
            }
            console.log('query:-', query);
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
            let reqCount = await Sys.App.Services.GroupHallServices.getHallCount(query);

            let data = await Sys.App.Services.GroupHallServices.getHallDatatable(query, length, start, sort);
            console.log('groupHall Data', data);
            let ghData = [];
            for (let i = 0; i < data.length; i++) {
                let ghArray = {};
                ghArray.groupHallId = data[i].groupHallId;
                ghArray.name = data[i].name;
                ghArray.halls = data[i].halls.length;
                ghArray._id = data[i]._id;
                ghArray.status = data[i].status;
                ghArray.tvId = data[i].tvId;
                ghData.push(ghArray);
            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': ghData,
            };

            //console.log("data:::::::::::::", data)

            return res.send(obj);
        } catch (e) {
            console.log("Error in getGroupHall", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            })
        }
    },

    addGroupHall: async function (req, res) {
        try {
            let hallOption = [
                '_id',
                'name',
                'hallId'
            ];
            let qurey = { status: 'active', 'groupHall': { $in: [null, {}] } };
            // let agentData = await Sys.App.Services.AgentServices.getAllAgentDataSelect(qurey, columns);
            let hallData = await Sys.App.Services.HallServices.getAllHallDataSelect(qurey, hallOption);
            console.log('hallData', hallData);
            let proQuery = { status: "active" };
            let productData = await Sys.App.Services.ProductServices.getByData(proQuery);


            let keys = [
                "edit_hall",
                "add_hall",
                "dashboard",
                "hall_name",
                "hall_number",
                "ip_address",
                "address",
                "city",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel",
                "edit_group_of_halls",
                "add_group_of_halls",
                "create_group_of_halls",
                "group_of_hall_name",
                "enter",
                "assign",
                "choose_halls",
                "group_of_hall_note",
                "select_product",
                "begin_typing_a_name_to_filter",
                "select_one_goh",
                "select_one_product"

            ]

            let grouphallData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                groupHallActive: 'active',
                hallData: hallData,
                productData: productData,
                disabledHalls: [],
                slug: 'Add',
                grouphallData: grouphallData,
                navigation: grouphallData
            };
            return res.render('GroupHall/addGroupHall', data);
            // return res.render('GroupHall/addGroupHallTest', data);
        } catch (e) {
            console.log("Error in addGroupHall page", e);
        }
    },


    //Testing Purpose only
    // addGroupHallTest: async function (req, res) {
    //     try {
    //         let columns = [
    //             '_id',
    //             'name',
    //             'agentId'
    //         ];
    //         let hallOption = [
    //             'name',
    //             'hallId'
    //         ];
    //         let qurey = { 'groupHall.name': { $exists: false }, status: 'active' };
    //         let agentData = await Sys.App.Services.AgentServices.getAllAgentDataSelect(qurey, columns);
    //         let hallData = await Sys.App.Services.HallServices.getAllHallDataSelect(qurey, hallOption);
    //         console.log('hallData', hallData);
    //         let proQuery = { status: "active" };
    //         let productData = await Sys.App.Services.ProductServices.getByData(proQuery);
    //         var data = {
    //             App: Sys.Config.App.details,
    //             Agent: req.session.details,
    //             error: req.flash("error"),
    //             success: req.flash("success"),
    //             groupHallActive: 'active',
    //             dataAgent: agentData,
    //             hallData: hallData,
    //             productData: productData
    //         };
    //         return res.render('GroupHall/addGroupHallTest', data);
    //     } catch (e) {
    //         console.log("Error in addGroupHallTest", e);
    //     }
    // },

    addGroupHallPostData: async function (req, res) {
        let keys = ["please_select_agent_hall", "group_hall_name_already_exists", "please_select_product", "not_found_or_inactive", "is_already_assigned_to_another_group_of_halls", "group_hall_added_successfully", "group_hall_not_created"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {
            console.log("addHallPostData", req.body);
            var ID = Date.now()
            var createID = await Sys.Helper.bingo.dateTimeFunction(ID);
            let groupHallId = `GH_${createID}`;
            /* let addHallPostData {
                name: 'grp3',
                agentname: [ '63299e97c45cbf5b7cccfde6', '63299efac45cbf5b7cccfde7' ],
                agentHalls: [
                  [ '20220919_032458_Hall', '20220919_034636_Hall' ],
                  [ '20220919_032458_Hall', '20220919_034636_Hall' ]
                ],
                product: [ '63299f1bc45cbf5b7cccfde8', '63299f36c45cbf5b7cccfde9' ],
                status: 'active'
              } */
            let groupHallName = req.body.name;
            groupHallName = groupHallName.trim();
            let grpHall = await Sys.App.Services.GroupHallServices.getGroupHall({ name: groupHallName });
            if (grpHall) {
                req.flash('error', translate.group_hall_name_already_exists)//'Group Hall name already exists');
                return res.redirect('/groupHall');
            }
            // if (req.body.agentname == undefined || req.body.agentname.length == 0) {
            //     req.flash('error', 'Please select agent');
            //     return res.redirect('/groupHall');
            // }
            if (req.body.halls == undefined || req.body.halls.length == 0) {
                req.flash('error', translate.please_select_agent_hall)// 'Please select agent hall');
                return res.redirect('/groupHall');
            }
            if (req.body.product == undefined || req.body.product.length == 0) {
                req.flash('error', translate.please_select_product)//'Please select product');
                return res.redirect('/groupHall');
            }
            // let agentname = req.body.agentname;
            let halls = req.body.halls;
            console.log('first:-', groupHallId, halls)
            let agents = [];
            // for (let i = 0; i < agentname.length; i++) {
            //     let agentData = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: agentname[i], status: 'active' });
            //     console.log('agentData:-', agentData);
            //     if (agentData) {
            //         let agentHalls = '';
            //         for (let j = 0; j < halls.length; j++) {
            //             console.log('j i', j, i);
            //             if (j == i) {
            //                 console.log('halls[j]', halls[j]);
            //                 await Sys.App.Services.AgentServices.updateAgentData({ _id: agentname[i] }, { $set: { 'groupHall.name': groupHallName, 'groupHall.groupHallId': groupHallId, hall: halls[j] } });
            //                 if (!Array.isArray(halls[j])) {
            //                     agentHalls = [halls[j]];
            //                 } else {
            //                     agentHalls = halls[j];
            //                 }

            //                 break;
            //             }
            //         }
            //         let agentArray = {
            //             id: agentData.id,
            //             name: agentData.name,
            //             status: agentData.status,
            //             halls: agentHalls
            //         }
            //         agents.push(agentArray);
            //     } else {
            //         req.flash('error', 'Agent Not Found OR Inactive');
            //         return res.redirect('/groupHall');
            //     }
            // }
            // console.log('agents:-', agents);

            halls = halls.reduce((acc, curr) => acc.concat(curr), []);
            halls = halls.filter((v, i, a) => a.indexOf(v) === i);
            console.log('halls:-', halls);
            // for (let k = 0; k < halls.length; k++) {
            //     console.log('halls[j][k]', halls[k]);
            //     let hallData = await Sys.App.Services.HallServices.getSingleHall({ hallId: halls[k], status: 'active' });
            //     console.log('hallData', hallData);
            //     if (!hallData) {
            //         req.flash('error', `${halls[k]} Not Found OR Inactive`);
            //         return res.redirect('/groupHall');
            //     } else {
            //         let agentId = await Sys.App.Services.AgentServices.getSingleAgentData({ hall: { $all: [halls[k]] } });
            //         await Sys.App.Services.HallServices.updateManyDataById({ hallId: halls[k] }, { $set: { 'groupHall.name': groupHallName, 'groupHall.groupHallId': groupHallId, 'agents.name': agentId.name } });
            //     }
            // }
            let hallsArray = [];
            for (let k = 0; k < halls.length; k++) {
                let hallData = await Sys.App.Services.HallServices.getSingleHall({ _id: halls[k], status: 'active' });
                console.log('hallData', hallData);
                if (!hallData) {
                    req.flash('error', `${halls[k]} ${translate.not_found_or_inactive}`)//Not Found OR Inactive`);
                    return res.redirect('/groupHall');
                } else if (hallData.groupHall.name) {
                    req.flash('error', `${hallData.name} ${translate.is_already_assigned_to_another_group_of_halls} `)// is Already assigned to Another Group of Halls`);
                    return res.redirect('/groupHall');
                } else {
                    let hallArray = {
                        id: hallData._id.toString(),
                        name: hallData.name,
                        status: hallData.status
                    }
                    hallsArray.push(hallArray);
                }
            }
            let products = req.body.product;

            // Add TV Id
            const gohTvId = await module.exports.generateUniqueTvId();
            let tvId;
            if (gohTvId.status == "success" && gohTvId.newTvId) {
                tvId = gohTvId.newTvId;
            } else {
                req.flash('error', translate.something_went_wrong)// 'Something went wrong');
                return res.redirect('/groupHall');
            }

            let GroupHall = {
                name: req.body.name,
                groupHallId: groupHallId,
                halls: hallsArray,
                products: products,
                status: req.body.status,
                tvId: tvId
            }
            let createGH = await Sys.App.Services.GroupHallServices.insertHallData(GroupHall);
            console.log('createGH', createGH);
            if (createGH && !(createGH instanceof Error)) {
                if (hallsArray.length) {
                    for (let i = 0; i < hallsArray.length; i++) {
                        //Update into Hall collection
                        await Sys.App.Services.HallServices.updateHallData({ _id: hallsArray[i].id }, {
                            "$set": {
                                "groupHall": {
                                    "name": groupHallName,
                                    "id": createGH._id.toString()
                                }
                            }
                        });
                    }
                }
                req.flash('success', translate.group_hall_added_successfully)//'Group Hall Added successfully');
                return res.redirect('/groupHall');
            } else {
                req.flash('error', translate.group_hall_not_created)//'GroupHall Not Created');
                return res.redirect('/groupHall');
            }
        } catch (e) {
            console.log("Error add groupofHall post data ", e);
            req.flash('error', "Internal Server Error")//'Internal Server Error');
            return res.redirect('/groupHall');
        }
    },

    groupHallDataView: async function (req, res) {
        try {

            let groupHall = await Sys.App.Services.GroupHallServices.getById(req.params.id);

            let qurey = {};
            // let agentData = await Sys.App.Services.AgentServices.getByData(qurey)
            let hallOption = [
                '_id',
                'name',
                'hallId'
            ];
            let hallData = await Sys.App.Services.HallServices.getAllHallDataSelect(qurey, hallOption);
            console.log('hallData', hallData);
            let productData = await Sys.App.Services.ProductServices.getByData(qurey);

            let keys = [
                "edit_hall",
                "add_hall",
                "dashboard",
                "hall_name",
                "hall_number",
                "ip_address",
                "address",
                "city",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel",
                "group_of_id",
                "group_of_name",
                "number_of_hall_assigned",
                "tv_screen_url",
                "view_group_of_hall",
                "group_of_hall",
                "group_of_hall_name",
                "enter",
                "assign",
                "choose_halls",
                "group_of_hall_note",
                "select_product",
                "begin_typing_a_name_to_filter",
                "select_one_goh",
                "select_one_product"

            ]

            let grouphallData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                groupHallActive: 'active',
                GroupHall: groupHall,
                hallData: hallData,
                productData: productData,
                grouphallData: grouphallData,
                navigation: grouphallData
            };
            return res.render('GroupHall/groupHallView', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editGroupHall: async function (req, res) {
        try {
            let keys = [
                "edit_hall",
                "add_hall",
                "dashboard",
                "hall_name",
                "hall_number",
                "ip_address",
                "address",
                "city",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel",
                "group_of_hall_can_not_be_edited_because_it_is_in_currently_running_or_upcoming_game",
                "edit_group_of_halls",
                "add_group_of_halls",
                "create_group_of_halls",
                "group_of_hall_name",
                "enter",
                "assign",
                "choose_halls",
                "group_of_hall_note",
                "select_product",
                "begin_typing_a_name_to_filter",
                "select_one_goh",
                "select_one_product"

            ]

            let grouphallData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
           
            let groupHall = await Sys.App.Services.GroupHallServices.getById(req.params.id);
            let query = {
                "gameType": { "$in": ["game_2", "game_3"] },
                "status": { "$in": ["active", "running"] },
                "groupHalls.id": groupHall._id.toString()
            }
            let gameCount = await Sys.App.Services.GameService.getSelectedParentGameCount(query);
            if (gameCount) {
                req.flash('error', grouphallData.group_of_hall_can_not_be_edited_because_it_is_in_currently_running_or_upcoming_game)//'Group of Hall Can not be edited because it is in Currently Running or Upcoming Games.');
                return res.redirect('/groupHall');
            }
            const startDate = new Date(new Date().setHours(0, 0, 0, 0));
            const endDate = new Date(new Date().setHours(23, 59, 50, 59));
            let query2 = {
                "status": { "$nin": ["finish"] },
                "stopGame": false,
                "isSavedGame": false,
                "startDate": { $lte: endDate },
                "endDate": { $gte: startDate },
                "groupHalls.id": groupHall._id.toString()
            }
            console.log(JSON.stringify(query2));
            let disbledHalls = [];
            let scheduleCount = await Sys.App.Services.scheduleServices.getDailySchedulesByData(query2, { groupHalls: 1 }, {});
            console.log("schedule count", scheduleCount);
            if (scheduleCount.length) {
                for (let j = 0; j < scheduleCount.length; j++) {
                    for (let i = 0; i < scheduleCount[j].groupHalls.length; i++) {
                        if (groupHall._id.toString() == scheduleCount[j].groupHalls[i].id) {
                            const element = scheduleCount[j].groupHalls[i];
                            for (let index = 0; index < element.selectedHalls.length; index++) {
                                disbledHalls.push(element.selectedHalls[index].id);
                            }
                        }
                    }
                }
            }
            let hallOption = [
                '_id',
                'name',
                'hallId'
            ];
            let qurey = { $and: [{ $or: [{ 'groupHall': { $in: [null, {}] } }, { 'groupHall.name': groupHall.name }] }, { status: 'active' }] };
            let hallData = await Sys.App.Services.HallServices.getAllHallDataSelect(qurey, hallOption);

            console.log('hallData', hallData, disbledHalls);
            let productData = await Sys.App.Services.ProductServices.getByData(qurey);




            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                groupHallActive: 'active',
                GroupHall: groupHall,
                hallData: hallData,
                productData: productData,
                disbledHalls: disbledHalls,
                slug: "Edit",
                grouphallData: grouphallData,
                navigation: grouphallData
            };
            return res.render('GroupHall/addGroupHall', data);
        } catch (e) {
            console.log("Error in edit group hall", e);
            req.flash('error', 'Server side error while loading the page.');
            return res.redirect('/groupHall');
        }
    },


    editGroupHallPostData: async function (req, res) {
        let keys = ["something_went_wrong", "groupHall_update_successfully","group_hall_name_already_exists","no_group_hall_found","please_select_hall","group_of_hall_not_update","please_select_product","already_assigned_to_another_group_of_halls", "not_found_or_inactive"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {
            console.log("editHallPostData", req.body);
            let groupHallName = req.body.name;
            groupHallName = groupHallName.trim();
            let GroupHall = await Sys.App.Services.GroupHallServices.getSingleHallData({ _id: { $ne: req.params.id }, name: groupHallName });
            if (GroupHall) {
                req.flash('error', translate.group_hall_name_already_exists )//'Group Hall Name Already exists');
                return res.redirect('/groupHallEdit/' + req.params.id);
            }
            GroupHall = await Sys.App.Services.GroupHallServices.getSingleHallData({ _id: req.params.id });
            let oldGroupHallName = GroupHall.name;
            if (!GroupHall) {
                req.flash('error', translate.no_group_hall_found)//'NO Group Hall found');
                return res.redirect('/groupHall');
            }

            if (req.body.halls == undefined || req.body.halls.length == 0) {
                req.flash('error', translate.please_select_hall)//'Please select hall');
                return res.redirect('/groupHallEdit/' + req.params.id);
            }
            if (req.body.product == undefined || req.body.product.length == 0) {
                req.flash('error', translate.please_select_product)//'Please select product');
                return res.redirect('/groupHallEdit/' + req.params.id);
            }
            let halls = req.body.halls;
            console.log('first:-', halls)
            halls = halls.reduce((acc, curr) => acc.concat(curr), []);
            halls = halls.filter((v, i, a) => a.indexOf(v) === i);
            console.log('halls:-', halls);
            let hallsArray = [];

            //Adding Halls into Group Hall and Updating each Hall
            for (let k = 0; k < halls.length; k++) {
                let hallData = await Sys.App.Services.HallServices.getSingleHall({ _id: halls[k], status: 'active' });
                console.log('hallData', hallData);
                if (!hallData) {
                    req.flash('error', `${halls[k]} ${translate.not_found_or_inactive}`);
                    return res.redirect('/groupHall');
                } else if (hallData.groupHall.name && hallData.groupHall.name !== oldGroupHallName) {
                    req.flash('error', `${hallData.name} ${translate.already_assigned_to_another_group_of_halls}`)//Already assigned to another Group of Halls`);
                    return res.redirect('/groupHall');
                } else {
                    let hallArray = {
                        id: hallData._id.toString(),
                        name: hallData.name,
                        status: hallData.status
                    }
                    hallsArray.push(hallArray);
                    //Update into Hall collection
                    await Sys.App.Services.HallServices.updateHallData({ _id: hallData._id }, {
                        "$set": {
                            "groupHall": {
                                "name": groupHallName,
                                "id": GroupHall._id.toString()
                            }
                        }
                    });
                }
            }
            //Retrieve out halls which are not included in new hallArray
            let removedHalls = GroupHall.halls.filter(hall => {
                return !hallsArray.some(element => element.id.toString() === hall.id.toString());
            }).map(element => element.id);
            console.log("remove halls", removedHalls);
            if (removedHalls.length) {
                await Sys.App.Services.HallServices.updateManyDataById({ _id: { "$in": removedHalls } }, {
                    "$set": {
                        "groupHall": {}
                    }
                });
            }
            let products = req.body.product;
            let data = {
                name: groupHallName,
                halls: hallsArray,
                products: products,
                status: req.body.status,
            }
            let grouphallUpdated = await Sys.App.Services.GroupHallServices.updateHallData({ _id: req.params.id }, data)

            if (!grouphallUpdated) {
                req.flash('error', translate.group_of_hall_not_update )//'group Of Hall not updated');
                return res.redirect('/groupHallEdit/' + req.params.id);
            }
            req.flash('success', translate.groupHall_update_successfully)//'groupHall updated successfully');
            return res.redirect('/groupHall');
        } catch (e) {
            console.log("Error in editGroupHall", e);
            req.flash('error', "Something went wrong")//'Something went wrong');
            return res.redirect('/groupHall');
        }
    },


    getGroupHallDelete: async function (req, res) {
        try {
            if (req.body.id == '') {
                return res.send("error");
            }
            let groupHall = await Sys.App.Services.GroupHallServices.getSingleHallData({ _id: req.body.id });
            console.log("deleting ghall", groupHall);
            if (groupHall) {
                let query = {
                    "status": { "$in": ["active", "running"] },
                    "groupHalls": { $elemMatch: { "id": groupHall._id.toString() } }
                }
                let gameCount = await Sys.App.Services.GameService.getSelectedParentGameCount(query);
                if (!gameCount) {
                    if (groupHall.halls.length) {
                        console.log("grphall delete", groupHall);
                        let hallIdArr = groupHall.halls.map(hall => hall.id);
                        //Update into Hall collection
                        await Sys.App.Services.HallServices.updateManyDataById({ _id: { "$in": hallIdArr } }, {
                            "$set": {
                                "groupHall": {}
                            }
                        });
                    }
                    await Sys.App.Services.GroupHallServices.deleteHall(groupHall._id);
                    return res.send("success");
                } else {
                    return res.send({
                        status: "fail",
                        message:await Sys.Helper.bingo.getSingleTraslateData(["group_of_hall_assigned_in_running_or_upcoming_game._so_cannot_be_deleted"], req.session.details.language) ,//"Group of Hall Assigned in Running Or Upcoming Game. So, cannot be deleted."
                    });
                }
            } else {
                return res.send({
                    status: "fail",
                    message: await Sys.Helper.bingo.getSingleTraslateData(["grouphall_not_found"], req.session.details.language),//"GroupHall Not Found."
                });
            }
        } catch (e) {
            console.log("Error", e);
            return res.send({
                status: "fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language),//"Something Went Wrong."
            });
        }
    },

    removedGroup: async function (req, res) {
        try {
            console.log('removedGroup call query:', req.query)
            let groupHall = await Sys.App.Services.GroupHallServices.getSingleHallData({ _id: req.query.groupId });
            console.log('groupHall', groupHall);
            if (groupHall || groupHall.length > 0) {
                let Id = mongoose.Types.ObjectId(groupHall._id)
                let AgentData = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.query.agentId, 'groupHall.name': groupHall.name });
                console.log('AgentData', AgentData);
                if (AgentData) {
                    let AgentUpdated = await Sys.App.Services.AgentServices.updateAgentData({ _id: req.query.agentId, 'groupHall.name': groupHall.name }, { $set: { groupHall: {}, hall: [] } });
                    console.log("AgentUpdated", AgentUpdated);
                    for (let i = 0; i < AgentData.hall.length; i++) {
                        let HallUpdate = await Sys.App.Services.HallServices.updateManyDataById({ hallId: AgentData.hall[i] }, { $set: { agents: {}, groupHall: {} } });
                        console.log("HallUpdate", HallUpdate);
                    }
                    let data = {};
                    data["$pull"] = {};
                    data["$pull"][`agents`] = { 'id': req.query.agentId };
                    console.log('data', data);
                    await Sys.App.Services.GroupHallServices.updateHallData({ _id: req.query.groupId }, data)
                    return res.send("success");
                } else {
                    return res.send("error");
                }
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    getAvailableGroupHalls: async function (req, res) {
        try {
            console.log("Dates", req.query, req.params);
            let isBotGame = false //req.query.isBotGame == "true" ? true : false;
            let startDate = req.query.startDate;
            let endDate = req.query.endDate;
            let id = req.query?.id;
            let data = [];
            let groupHallsAvailable = [];
            if (req.params.type.length == 0) {
                return res.send({
                    "status": "fail",
                    "message": await Sys.Helper.bingo.getSingleTraslateData(["game_type_not_found"], req.session.details.language),// "Game type not Found",
                    "groupHalls": []
                });
            }
            if (startDate !== '' && endDate !== '') {
                startDate = new Date(startDate);
                endDate = new Date(endDate);
                //Getting GroupHalls of all actvie and running games satisfying query condition
                let dataQuery = {
                    "gameType": req.params.type,
                    "status": { "$in": ['running', 'active'] },
                    "stopGame": false,
                    "$or": [{
                        "startDate": { "$lte": startDate },
                        "endDate": { "$gte": startDate }
                    }, {
                        "startDate": { "$lte": endDate },
                        "endDate": { "$gte": endDate }
                    }]
                }

                // if (isBotGame) {
                //     dataQuery.isBotGame = true;
                // }else{
                //     dataQuery.isBotGame = false;
                // }


                if (id) {
                    dataQuery['_id'] = {
                        "$nin": [mongoose.Types.ObjectId(id)]
                    }
                }

                if (req.session.details.role == 'agent') {
                    dataQuery['allHallsId'] = req.session.details.hall[0].id;
                }

                console.log("Query for date search", JSON.stringify(dataQuery));
                data = await Sys.App.Services.GameService.getParentGamesBySelectData(dataQuery, {
                    _id: 0,
                    groupHalls: 1
                });
                console.log("data 1", data);

                if (data.length && req.session.details.role == 'admin') {
                    let uniqueId = [];
                    for (let i = 0; i < data.length; i++) {
                        const element = data[i].groupHalls;
                        for (let j = 0; j < element.length; j++) {
                            uniqueId.push(element[j].id);
                        }
                    }
                    data = uniqueId.filter((v, i, a) => a.indexOf(v) === i);
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ _id: { "$nin": data }, status: "active" }, { name: 1 });
                    console.log("groupHallsAvailable", groupHallsAvailable);
                } else if (data.length && req.session.details.role == 'agent') {
                    groupHallsAvailable = [];
                } else {
                    if (req.session.details.role == 'agent') {
                        groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ "status": "active", "halls.id": req.session.details.hall[0].id }, { name: 1 });
                    } else {
                        groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ "status": "active" }, { name: 1 });
                    }
                }
            }
            return res.send({
                "status": "success",
                "groupHalls": groupHallsAvailable
            });
        } catch (e) {
            console.log("Error in getAvailable GroupHalls", e);
            return res.send({
                "status": "fail",
                "groupHalls": []
            });
        }
    },

    getGroupHallData: async function (req, res) {
        try {
            console.log("Get Group Hall Data API Called", req.body);
            let query = {}
            if (req.body.status) {
                query.status = req.body.status;
            }
            let result = await Sys.App.Services.GroupHallServices.getGroupHalls(query, { name: 1 });
            console.log("result", result);
            return res.send(
                {
                    status: "success",
                    groups: result
                }
            );
        } catch (error) {
            console.log("Error in getGroupHallData", error);
            return res.send(
                {
                    status: "failed",
                    groups: []
                }
            );
        }
    },

    generateUniqueTvId: async function () {
        try {
            const lastGoh = await Sys.App.Services.GroupHallServices.getSingleGoh({}, { tvId: 1 }, { sort: { _id: -1 } });
            let lastTvId = (lastGoh && lastGoh?.tvId) ? lastGoh.tvId : 0;
            let newTvId = lastTvId + 1;
            // Keep incrementing the newTvId until it's unique
            while (await Sys.App.Services.GroupHallServices.getHallCount({ tvId: newTvId }) > 0) {
                console.log("tvId is already available, check for new one", newTvId)
                newTvId++;
            }
            return { status: "success", newTvId: newTvId };
        } catch (e) {
            console.log("Error in geneating customer Number");
            return { status: "fail" };
        }

    },

    insertTvIdForExistingGoh: async function () {
        try {
            let allGohs = await Sys.App.Services.GroupHallServices.getGroupHalls({}, { tvId: 1, name: 1 }, { sort: { _id: 1 } });
            for (let g = 0; g < allGohs.length; g++) {
                if (!allGohs[g].tvId) {
                    const gohTvId = await module.exports.generateUniqueTvId();
                    if (gohTvId.status == "success" && gohTvId.newTvId) {
                        await Sys.App.Services.GroupHallServices.updateHallData({ _id: allGohs[g]._id }, { tvId: gohTvId.newTvId })
                    }
                }
            }
        } catch (e) {
            console.log("Error inserting Tv Id to Existing GOH", e);
        }
    }



}