const { date } = require('joi');
let Sys = require('../../Boot/Sys');
let parseInt = require('parse-int');
let ObjectId = require('mongodb').ObjectId;
module.exports = {

    redFlagCategory: async function (req, res) {
        try {
          let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Report Management'] || [];
                let stringReplace =req.session.details.isPermission['Report Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Report Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            let keys = [
                "red_flag_category",
                "choose_a_category",
                "choose_a_category_type",
                "table",
                "view_schedule",
                "delete_schedule",
                "add_close_day",
                "action",
                "amount",
                "email",
                "enter",
                "all",
                "active",
                "upcoming",
                "search_game_name",
                "search",
                "add_special_game",
                "create_daily_schedule",
                "sure_want_to_stop_game",
                "not_be_able_to_recover_game",
                "yes",
                "no",
                "stop_after_completing_running_game",
                "game_will_stop_after_completing_running_game",
                "sorry_game_not_stopeed",
                "game_not_stopped",
                "stopped",
                "cancelled",
                "not_be_able_to_resume_if_stopped",
                "show",
                "entries",
                "previous",
                "next",
                "add",
                "are_you_sure",
                "not_able_to_recover_after_delete",
                "yes_delete",
                "no_cancle",
                "deleted",
                "game_delete_success",
                "game_not_deleted_as_about_to_start",
                "game_not_deleted",
                "view_game",
                "edit_game",
                "stop_game",
                "add_close_day",
                "you_will_not_be_able_to_recover_this_schedule",
                "schedule_delete_success",
                "schedule_not_deleted_as_about_to_start",
                "schedule_not_deleted",
                "transfer_hall_access",
                "master_hall",
                "update",
                "cancel",
                "select",
                "are_you_sure",
                "do_you_want_to_transfer_hall_access",
                "success",
                "cancel_button",
                "please_enter_amount",
                "dashboard",
                "used_in_a_day",
                "used_per_week",
                "deposited_in_a_day",
                "deposited_per_week",
                "lost_in_a_day",
                "lost_in_a_month",
                "risk_country",
                "politically_exposed_person",
                "has_not_verified_their_account_with_bank_id"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let redFlagData = [
                {id: 1,name: translate.used_in_a_day},
                {id: 2,name: translate.used_per_week},
                {id: 3,name: translate.deposited_in_a_day},
                {id: 4,name: translate.deposited_per_week},
                {id: 5,name: translate.lost_in_a_day},
                {id: 6,name: translate.lost_in_a_month},
                {id: 7,name: translate.risk_country},
                {id: 8,name: translate.politically_exposed_person},
                {id: 9,name: translate.has_not_verified_their_account_with_bank_id},
                ]

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ReportMenu: "active",
                redFlagCategory: 'active',
                redFlagData: redFlagData,
                gameManage: translate,
                navigation: translate,
                current_language: req.session.details.language
            };
            if(viewFlag){
                return res.render('report/redFlagCategories', data);
            }else{
                req.flash('error',await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    getRedFlagCategory: async function (req, res) {
        try {
            console.log("getRedFlagCategory calling",typeof req.params.id ,req.query.amount);
            let categoryId = Number(req.params.id);
            let keys = [
            "red_flag_category",
            "choose_a_category",
            "choose_a_category_type",
            "user_name",
            "PEP",
            "sr_no",
            "email",
            "amount",
            "daily_schedule_id",
            "start_date_and_end_date",
            "time_slot",
            "group_of_halls",
            "master_hall",
            "game_type",
            "status",
            "game_id",
            "game_name",
            "start_date_and_time",
            "end_date_and_time",
            "prize_of_lucky_number",
            "notification_start_time",
            "group_of_halls",
            "search",
            "total_seconds_to_display_ball",
            "number_of_minimum_tickets_to_start_the_game",
            "status",
            "action",
            "game_id",
            "game_name",
            "start_date_and_end_date",
            "group_of_hall",
            "status",
            "action",
            "game_id",
            "pattern_name",
            "pattern_price",
            "action",
            "game_id",
            "pattern_name",
            "pattern_price",
            "action",
            "pattern_name_prize",
            "bet_multiplier",
            "bet_amount",
            "game4_is_bot_game",
            "game4_bot_count",
            "total_bot_game_to_run",
            "game_4_second_1_18",
            "game_4_second_19_end",
            "please_enter_amount"
        ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            
            if (categoryId === null) {
                let data = {
                    status: false,
                    message: "Data not found"
                };
                return res.send(data);
            }
            let gameData = {  name: ""}
            switch (categoryId) {
                case 1:
                    gameData.name = "Used in a day";
                    break;
                case 2:
                    gameData.name = "Used per week";
                    break;
                case 3:
                    gameData.name = "Deposited in a day";
                    break;
                case 4:
                    gameData.name = "Deposited per week";
                    break;
                case 5:
                    gameData.name = "Lost in a day";
                    break;
                case 6:
                    gameData.name = "Lost in a month";
                    break;
                case 7:
                    gameData.name = "Risk country";
                    break;
                case 8:
                    gameData.name = "Politically exposed person";
                    break;
                case 9:
                    gameData.name = "Has not verified their account with bank id";
                    break;
            }
            const Game = [];
            let theadField = await getTheadField(categoryId, translate);
            if (!theadField) {
                let data = {
                    status: false,
                    message: "Data not found"
                };
                return res.send(data);
            }

            let data = {
                status: true,
                gameData: gameData,
                theadField: theadField,
                addBtn: false,
                Game: Game
            };
            return res.send(data);

        } catch (error) {
            console.log('Error in getRedFlagCategory: ', error);
            let data = {
                status: false,
                message: "Something went wrong"
            };
            return res.send(data);
        }
    },

    getPlayersRedFlagList: async function (req, res) {
        try {
            console.log("getPlayersRedFlagList calling", req.query);
            let order = req.query.order;
            let amount = req.query.amount;
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
            let query = {};
            let search = req.query.search.value;
            
            let playersData;
            let playersCount;
            if(amount){
                amount = Number(req.query.amount);
                console.log("amount",typeof amount, amount);
                let startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 6);
                startDate.setHours(0,0,0,0);
                let endDate = new Date(); // today
                let pipeline = [];
                if(req.query.flagType == "1"){
                    pipeline = [
                      {
                        $match: {
                          finalPurchase: {$gte: amount},
                          date: {$gte: startDate.toISOString().slice(0,10), $lte: endDate.toISOString().slice(0,10)}
                        }
                      },
                      {
                        $group: {
                          _id: "$playerId",
                          totalPurchase: { $sum: "$finalPurchase" }
                        }
                      },
                      {
                        $lookup: {
                          from: "player",    // adjust if needed
                          localField: "_id",
                          foreignField: "_id",
                          as: "playerInfo"
                        }
                      },
                      { $unwind: "$playerInfo" },
                      {
                        $match: {
                          $or: [
                            { "playerInfo.username": { $regex: search, $options: "i" } },
                            { "playerInfo.email": { $regex: search, $options: "i" } }
                          ]
                        }
                      },
                      {
                        $project: {
                          _id: "$playerInfo._id",
                          username: "$playerInfo.username",
                          email: "$playerInfo.email",
                          amount: "$totalPurchase"
                        }
                      },
                      {
                        $sort: sort
                      }
                    ];
                    
                } else if(req.query.flagType == "2"){
                  pipeline = [
                    {
                      $match: {
                        date: {
                          $gte: startDate.toISOString().slice(0, 10),
                          $lte: endDate.toISOString().slice(0, 10)
                        }
                      }
                    },
                    {
                      // Convert "date" string into real Date object
                      $addFields: {
                        dateObj: { $dateFromString: { dateString: "$date" } }
                      }
                    },
                    {
                      $addFields: {
                        week: { $isoWeek: "$dateObj" },
                        year: { $isoWeekYear: "$dateObj" }
                      }
                    },
                    {
                      $group: {
                        _id: {
                          playerId: "$playerId",
                          year: "$year",
                          week: "$week"
                        },
                        // Ignore negative finalPurchase values
                        weeklyPurchase: {
                          $sum: {
                            $cond: [{ $gte: ["$finalPurchase", 0] }, "$finalPurchase", 0]
                          }
                        }
                      }
                    }, 
                    {
                      $group: {
                        _id: "$_id.playerId",
                        totalQualifiedPurchase: { $sum: "$weeklyPurchase" }
                      }
                    },
                    {
                      $match: {
                        totalQualifiedPurchase: { $gte: amount }
                      }
                    },
                    {
                      $lookup: {
                        from: "player", // replace if needed
                        localField: "_id",
                        foreignField: "_id",
                        as: "playerInfo"
                      }
                    },
                    { $unwind: "$playerInfo" },
                    {
                      $match: {
                        $or: [
                          { "playerInfo.username": { $regex: search, $options: "i" } },
                          { "playerInfo.email": { $regex: search, $options: "i" } }
                        ]
                      }
                    },
                    {
                      $project: {
                        _id: "$playerInfo._id",
                        username: "$playerInfo.username",
                        email: "$playerInfo.email",
                        amount: "$totalQualifiedPurchase"
                      }
                    },
                    { $sort: sort }
                  ];
                } else if(req.query.flagType == "3"){
                    pipeline = [
                      {
                        $match: {
                          deposit: {$gte: amount},
                          date: {$gte: startDate.toISOString().slice(0,10), $lte: endDate.toISOString().slice(0,10)}
                        }
                      },
                      {
                        $group: {
                          _id: "$playerId",
                          totalDeposit: { $sum: "$deposit" }
                        }
                      },
                      {
                        $lookup: {
                          from: "player",    // adjust if needed
                          localField: "_id",
                          foreignField: "_id",
                          as: "playerInfo"
                        }
                      },
                      { $unwind: "$playerInfo" },
                      {
                        $match: {
                          $or: [
                            { "playerInfo.username": { $regex: search, $options: "i" } },
                            { "playerInfo.email": { $regex: search, $options: "i" } }
                          ]
                        }
                      },
                      {
                        $project: {
                          _id: "$playerInfo._id",
                          username: "$playerInfo.username",
                          email: "$playerInfo.email",
                          amount: "$totalDeposit"
                        }
                      },
                      {
                        $sort: sort
                      }
                    ];
                } else if(req.query.flagType == "4"){
                    pipeline = [
                      {
                        $match: {
                          date: {$gte: startDate.toISOString().slice(0,10), $lte: endDate.toISOString().slice(0,10)}
                        }
                      },
                      {
                        $addFields: {
                          week: { $isoWeek: { $dateFromString: { dateString: "$date" } } },
                          year: { $isoWeekYear: { $dateFromString: { dateString: "$date" } } }
                        }
                      },
                      {
                        $group: {
                          _id: {
                            playerId: "$playerId",
                            year: "$year",
                            week: "$week"
                          },
                          weeklyDeposit: { $sum: "$deposit" }
                        }
                      },
                      {
                        $match: {
                          weeklyDeposit: { $gte: amount }
                        }
                      },
                      {
                        $group: {
                          _id: "$_id.playerId",
                          totalQualifiedDeposit: { $sum: "$weeklyDeposit" }
                        }
                      },
                      {
                        $lookup: {
                          from: "player",    // change to your real collection if needed
                          localField: "_id",
                          foreignField: "_id",
                          as: "playerInfo"
                        }
                      },
                      {
                        $unwind: "$playerInfo"
                      },
                      {
                        $match: {
                          $or: [
                            { "playerInfo.username": { $regex: search, $options: "i" } },
                            { "playerInfo.email": { $regex: search, $options: "i" } }
                          ]
                        }
                      },
                      {
                        $project: {
                          _id: "$playerInfo._id",
                          username: "$playerInfo.username",
                          email: "$playerInfo.email",
                          amount: "$totalQualifiedDeposit"
                        }
                      },
                      {
                        $sort: sort
                      }
                    ];
                } else if(req.query.flagType == "5"){
                  pipeline = [
                    {
                      $match: {
                        loss: {$gte: amount},
                        date: {$gte: startDate.toISOString().slice(0,10), $lte: endDate.toISOString().slice(0,10)}
                      }
                    },
                    {
                      $group: {
                        _id: "$playerId",
                        totalLoss: { $sum: "$loss" }
                      }
                    },
                    {
                      $lookup: {
                        from: "player",    // adjust if needed
                        localField: "_id",
                        foreignField: "_id",
                        as: "playerInfo"
                      }
                    },
                    { $unwind: "$playerInfo" },
                    {
                      $match: {
                        $or: [
                          { "playerInfo.username": { $regex: search, $options: "i" } },
                          { "playerInfo.email": { $regex: search, $options: "i" } }
                        ]
                      }
                    },
                    {
                      $project: {
                        _id: "$playerInfo._id",
                        username: "$playerInfo.username",
                        email: "$playerInfo.email",
                        amount: "$totalLoss"
                      }
                    },
                    {
                      $sort: sort
                    }
                  ];
                  
                } else if(req.query.flagType == "6"){
                  pipeline = [
                    {
                      $match: {
                        date: {$gte: startDate.toISOString().slice(0,10), $lte: endDate.toISOString().slice(0,10)}
                      }
                    },
                    {
                      $addFields: {
                        year: { $year: { $dateFromString: { dateString: "$date" } } },
                        month: { $month: { $dateFromString: { dateString: "$date" } } }
                      }
                    },
                    {
                      $group: {
                        _id: {
                          playerId: "$playerId",
                          year: "$year",
                          month: "$month"
                        },
                        monthlyLoss: { $sum: "$loss" }
                      }
                    },
                    {
                      $match: {
                        monthlyLoss: { $gte: amount }
                      }
                    },
                    {
                      $group: {
                        _id: "$_id.playerId",
                        totalQualifiedLoss: { $sum: "$monthlyLoss" }
                      }
                    },
                    {
                      $lookup: {
                        from: "player",    // change to your real player collection name if needed
                        localField: "_id",
                        foreignField: "_id",
                        as: "playerInfo"
                      }
                    },
                    {
                      $unwind: "$playerInfo"
                    },
                    {
                      $match: {
                        $or: [
                          { "playerInfo.username": { $regex: search, $options: "i" } },
                          { "playerInfo.email": { $regex: search, $options: "i" } }
                        ]
                      }
                    },
                    {
                      $project: {
                        _id: "$playerInfo._id",
                        username: "$playerInfo.username",
                        email: "$playerInfo.email",
                        amount: "$totalQualifiedLoss"
                      }
                    },
                    {
                      $sort: sort
                    }
                  ];
                }
                // console.log("pipeline",JSON.stringify(pipeline,null,2));
                playersData = await Sys.App.Services.transactionServices.getDataByAggre(pipeline);
                // console.log("playersData:-", playersData);
            }else{
                if(search){
                  if(req.query.flagType == "7"){
                    query.$or = [
                      {username: {$regex: search, $options: 'i'}},
                      {email: {$regex: search, $options: 'i'}},
                      {"addressDetails.country": {$regex: search, $options: 'i'}}
                    ];
                  }else {
                    query.$or = [
                      {username: {$regex: search, $options: 'i'}},
                      {email: {$regex: search, $options: 'i'}}
                    ];
                  }
                }
                let column = [];
                if(req.query.flagType == "7"){
                  let riskCountry = await Sys.App.Services.transactionServices.getRiskCountry({});
                    let Countries = riskCountry.map((c) => c.countryName);
                    column = ['_id', 'username', 'email', 'addressDetails.country'];
                    query["addressDetails.country"]= {$in: Countries};
                    playersCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
                    playersData = await Sys.App.Services.PlayerServices.getAllPlayerDataTableSelected(query, column, start, length, sort);
                  }else if(req.query.flagType == "8"){
                    column = ['_id', 'username', 'email', 'PEP'];
                    query.PEP = 'yes';
                    playersCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
                    playersData = await Sys.App.Services.PlayerServices.getAllPlayerDataTableSelected(query, column, start, length, sort);
                  }else if(req.query.flagType == "9"){
                    column = ['_id', 'username', 'email'];
                    //query["bankIdAuth"]= {$exists:true};
                    query.$and = query.$and || [];
                    query.$and.push({
                      $or: [
                        { bankIdAuth: { $exists: false } },
                        { bankIdAuth: {} },
                        { "bankIdAuth.status": { $ne: "COMPLETED" } }
                      ]
                    });
                    query["hall.status"] = "Approved";
                    query["userType"] = "Online";
                    playersCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
                    playersData = await Sys.App.Services.PlayerServices.getAllPlayerDataTableSelected(query, column, start, length, sort);
                  }
            }
            // console.log('playersData',JSON.stringify(playersData,null,2));

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': amount ? playersData.length : playersCount || 0,
                'recordsFiltered': amount ? playersData.length : playersCount || 0,
                'data': playersData || [],
            };

            // console.log("data:::: getPlayersRedFlagList:::::::::", obj)

            return res.send(obj);

        } catch (error) {
            console.log('Error in getPlayersRedFlagList: ', error);
            return new Error(error);
        }
    },

    dailyTransctionUpdate: async function(data) {
        try {
            console.log("dailyTransctionUpdate calling", data);
            let {type, playerId, hallId} = data;

            let playerData = await Sys.App.Services.PlayerServices.getSinglePlayerData({_id: playerId}, ['hall.id', 'userType']);
           
            if(playerData && playerData.userType === "Bot"){
              return ({status: true, message: "No need to update daily transaction for bot players"});
            }
            
            hallId ||= playerData?.hall?.id;  // Only assigns if hallId is falsy.

            // if(!hallId){
            //     let playerData = await Sys.App.Services.PlayerServices.getSinglePlayerData({_id: playerId}, ['hall.id']);
            //     hallId = playerData.hall.id;
            // }
            let dailyData = {};
            let date = new Date().toISOString().slice(0, 10);
            let query ={date,playerId,hallId}
            if(type == "deposit"){
                dailyData = {
                    $inc: {
                        deposit: data.deposit
                    }
                };
            }else if(type == "purchase"){
              dailyData = {
                  $inc: {
                      finalPurchase: data.purchase,
                      purchase: data.purchase,
                      loss: data.purchase
                  }
              };
          } else if(type == "withdraw"){
                dailyData = {
                    $inc: {
                        withdraw: data.withdraw
                    }
                };
            }else if(type == "cancel"){
                dailyData = {
                    $inc: {
                        cancel: data.cancel,
                        finalPurchase: -data.cancel,
                        loss: -data.cancel
                    }
                };
            }else if(type == "winning"){
                dailyData = {
                    $inc: {
                        winning: data.winning,
                        loss: -data.winning
                    }
                };
            }
            console.log("dailyData",JSON.stringify(dailyData,null,2));
            let dailyTransaction = await Sys.App.Services.transactionServices.dailyTransactionUpdate(query,dailyData);
            if(dailyTransaction){
                return ({status: true, message: "Daily transaction updated successfully"});
            }else{
                return ({status: false, message: "Daily transaction not updated"});
            }
        } catch (error) {
            console.log('Error in dailyTransctionUpdate: ', error);
            return new Error(error);
        }
    },

    viewUserTransaction: async function (req, res) {
      try {
        console.log("viewUserTransaction calling", req.query);
        let viewFlag = true;
        let editFlag = true;
        let deleteFlag = true;
        let addFlag = true;
        let startFlag = true;
        let pauseFlag = true;
        console.log("session details of req sender", req.session.details);
        if(!req.session.details.isSuperAdmin){
            // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
            // if (user == null || user.length == 0) {
            //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
            // }
            // let stringReplace = user.permission['Games Management'] || [];
            let stringReplace =req.session.details.isPermission['Games Management'] || [];
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

            if (stringReplace.indexOf("start") == -1) {
                startFlag = false;
            }

            if (stringReplace.indexOf("pause") == -1) {
                pauseFlag = false;
            }
        }
        let keys = [
            "table",
            "action",
            "amount",
            "email",
            "enter",
            "all",
            "active",
            "search",
            "not_be_able_to_recover_game",
            "yes",
            "no",
            "stop_after_completing_running_game",
            "game_will_stop_after_completing_running_game",
            "sorry_game_not_stopeed",
            "game_not_stopped",
            "stopped",
            "cancelled",
            "not_be_able_to_resume_if_stopped",
            "show",
            "entries",
            "previous",
            "next",
            "add",
            "are_you_sure",
            "not_able_to_recover_after_delete",
            "yes_delete",
            "no_cancle",
            "deleted",
            "game_delete_success",
            "game_not_deleted_as_about_to_start",
            "game_not_deleted",
            "cancel",
            "select",
            "success",
            "cancel_button",
            "please_enter_amount"
          ]
          let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)


          let data = {
              App: Sys.Config.App.details,
              Agent: req.session.details,
              error: req.flash("error"),
              success: req.flash("success"),
              ReportMenu: "active",
              redFlagCategory: 'active',
              data: req.query,
              viewFlag: viewFlag,
              editFlag: editFlag,
              deleteFlag: deleteFlag,
              addFlag: addFlag,
              startFlag: startFlag,
              pauseFlag: pauseFlag,
              gameManage: translate,
              navigation: translate,
              current_language: req.session.details.language
          };
          return res.render('report/viewUserTransaction', data);
      } catch (e) {
          console.log("Error in viewUserTransaction", e);
      }
    },

    getUserTransactionHeader: async function (req, res) {
      try {
          console.log("getUserTransactionHeader calling",typeof req.params.id );
          let categoryId = Number(req.params.id);
          let keys = [
          "choose_a_category",
          "choose_a_category_type",
          "user_name",
          "PEP",
          "sr_no",
          "email",
          "amount",
          "daily_schedule_id",
          "start_date_and_end_date",
          "time_slot",
          "group_of_halls",
          "master_hall",
          "game_type",
          "status",
          "game_id",
          "game_name",
          "start_date_and_time",
          "end_date_and_time",
          "prize_of_lucky_number",
          "notification_start_time",
          "group_of_halls",
          "search",
          "total_seconds_to_display_ball",
          "number_of_minimum_tickets_to_start_the_game",
          "status",
          "action",
          "game_id",
          "game_name",
          "start_date_and_end_date",
          "group_of_hall",
          "status",
          "action",
          "game_id",
          "pattern_name",
          "pattern_price",
          "action",
          "game_id",
          "pattern_name",
          "pattern_price",
          "action",
          "pattern_name_prize",
          "bet_multiplier",
          "bet_amount",
          "game4_is_bot_game",
          "game4_bot_count",
          "total_bot_game_to_run",
          "game_4_second_1_18",
          "game_4_second_19_end",
          "please_enter_amount",
          "date"
      ]
          let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
          
          if (categoryId === null) {
              let data = {
                  status: false,
                  message: "Data not found"
              };
              return res.send(data);
          }
          let gameData = {  name: ""}
          switch (categoryId) {
              case 1:
                  gameData.name = "Used in a day";
                  break;
              case 2:
                  gameData.name = "Used per week";
                  break;
              case 3:
                  gameData.name = "Deposited in a day";
                  break;
              case 4:
                  gameData.name = "Deposited per week";
                  break;
              case 5:
                  gameData.name = "Lost in a day";
                  break;
              case 6:
                  gameData.name = "Lost in a month";
                  break;
          }
          let theadField = await getTheadViewField(categoryId, translate);
          if (!theadField) {
              let data = {
                  status: false,
                  message: "Data not found"
              };
              return res.send(data);
          }

          let data = {
              status: true,
              gameData: gameData,
              theadField: theadField,
              addBtn: false,
              Game: []
            };
          return res.send(data);

      } catch (error) {
          console.log('Error in getUserTransactionHeader: ', error);
          let data = {
              status: false,
              message: "Something went wrong"
          };
          return res.send(data);
      }
    },

    getUserTransactionList: async function (req, res) {
      try {
        console.log("getUserTransactionList calling", req.query);
        let order = req.query.order;
        let amount = req.query.amount;
        let id = req.query.id;
        let sort = {};
        
        if(req.query.flagType == "7" || req.query.flagType == "8" || req.query.flagType == "9"){
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
        }
        
        let start = parseInt(req.query.start);
        let length = parseInt(req.query.length);
        let query = {};
        let search = req.query.search.value;
        
        if(search){
          query.$or = [
            {username: {$regex: search, $options: 'i'}},
            {email: {$regex: search, $options: 'i'}}
          ];
        }
        
        let playersData;
        if(amount){
            amount = Number(req.query.amount);
            console.log("amount",typeof amount, amount);
            let startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);
            startDate.setHours(0,0,0,0);
            let endDate = new Date();
            let pipeline = [];
            if(req.query.flagType == "1"){
              pipeline = [
                {
                  $match: {
                    date: {
                      $gte: startDate.toISOString().slice(0,10),
                      $lte: endDate.toISOString().slice(0,10)
                    },
                    finalPurchase: { $gte: amount },
                    playerId: new ObjectId(id)
                  }
                },
                {
                  $lookup: {
                    from: "player",
                    localField: "playerId",
                    foreignField: "_id",
                    as: "playerInfo"
                  }
                },
                {
                  $unwind: "$playerInfo"
                },
                {
                  $project: {
                    username: "$playerInfo.username",
                    email: "$playerInfo.email",
                    date: 1,
                    amount: "$finalPurchase"
                  }
                },
                {
                  $sort: {
                    date: -1  // -1 for descending order
                  }
                }
              ];
            } else if(req.query.flagType == "2"){
              pipeline = [
                {
                  $match: {
                    date: {
                      $gte: startDate.toISOString().slice(0,10),
                      $lte: endDate.toISOString().slice(0,10)
                    },
                    playerId: new ObjectId(id)
                  }
                },
                {
                  $addFields: {
                    weekYear: {
                      $concat: [
                        { $toString: { $isoWeekYear: { $dateFromString: { dateString: "$date" } } } },
                        "-W",
                        { $toString: { $isoWeek: { $dateFromString: { dateString: "$date" } } } }
                      ]
                    }
                  }
                },
                {
                  $group: {
                    _id: {
                      playerId: "$playerId",
                      weekYear: "$weekYear"
                    },
                    totalPurchase: {
                      $sum: {
                        $cond: [{ $gt: ["$finalPurchase", 0] }, "$finalPurchase", 0]
                      }
                    }
                  }
                },
                {
                  $match: {
                    totalPurchase: { $gte: amount }
                  }
                },
                {
                  $lookup: {
                    from: "player",
                    localField: "_id.playerId",
                    foreignField: "_id",
                    as: "playerInfo"
                  }
                },
                {
                  $unwind: "$playerInfo"
                },
                {
                  $project: {
                    username: "$playerInfo.username",
                    email: "$playerInfo.email",
                    date: "$_id.weekYear",
                    amount: "$totalPurchase"
                  }
                },
                {
                  $sort: {
                    date: -1  // -1 for descending order
                  }
                }
              ];
            } else if(req.query.flagType == "3"){
              pipeline = [
                {
                  $match: {
                    date: {
                      $gte: startDate.toISOString().slice(0,10),
                      $lte: endDate.toISOString().slice(0,10)
                    },
                    deposit: { $gte: amount },
                    playerId: new ObjectId(id)
                  }
                },
                {
                  $lookup: {
                    from: "player",
                    localField: "playerId",
                    foreignField: "_id",
                    as: "playerInfo"
                  }
                },
                {
                  $unwind: "$playerInfo"
                },
                {
                  $project: {
                    username: "$playerInfo.username",
                    email: "$playerInfo.email",
                    date: 1,
                    amount: "$deposit"
                  }
                },
                {
                  $sort: {
                    date: -1  // -1 for descending order
                  }
                }
              ];
            } else if(req.query.flagType == "4"){
              pipeline = [
                {
                  $match: {
                    date: {
                      $gte: startDate.toISOString().slice(0,10),
                      $lte: endDate.toISOString().slice(0,10)
                    },
                    playerId: new ObjectId(id)
                  }
                },
                {
                  $addFields: {
                    weekYear: {
                      $concat: [
                        { $toString: { $isoWeekYear: { $dateFromString: { dateString: "$date" } } } },
                        "-W",
                        { $toString: { $isoWeek: { $dateFromString: { dateString: "$date" } } } }
                      ]
                    }
                  }
                },
                {
                  $group: {
                    _id: {
                      playerId: "$playerId",
                      weekYear: "$weekYear"
                    },
                    totalDeposit: { $sum: "$deposit" }
                  }
                },
                {
                  $match: {
                    totalDeposit: { $gte: amount }
                  }
                },
                {
                  $lookup: {
                    from: "player",
                    localField: "_id.playerId",
                    foreignField: "_id",
                    as: "playerInfo"
                  }
                },
                {
                  $unwind: "$playerInfo"
                },
                {
                  $project: {
                    username: "$playerInfo.username",
                    email: "$playerInfo.email",
                    date: "$_id.weekYear",
                    amount: "$totalDeposit"
                  }
                },
                {
                  $sort: {
                    date: -1  // -1 for descending order
                  }
                }
              ];
            } else if(req.query.flagType == "5"){
              pipeline = [
                {
                  $match: {
                    date: {
                      $gte: startDate.toISOString().slice(0,10),
                      $lte: endDate.toISOString().slice(0,10)
                    },
                    loss: { $gte: amount },
                    playerId: new ObjectId(id)
                  }
                },
                {
                  $lookup: {
                    from: "player",
                    localField: "playerId",
                    foreignField: "_id",
                    as: "playerInfo"
                  }
                },
                {
                  $unwind: "$playerInfo"
                },
                {
                  $project: {
                    username: "$playerInfo.username",
                    email: "$playerInfo.email",
                    date: 1,
                    amount: "$loss"
                  }
                },
                {
                  $sort: {
                    date: -1  // -1 for descending order
                  }
                }
              ];
            } else if(req.query.flagType == "6"){
              pipeline = [
                {
                  $match: {
                    date: {
                      $gte: startDate.toISOString().slice(0,10),
                      $lte: endDate.toISOString().slice(0,10)
                    },
                    playerId: new ObjectId(id)
                  }
                },
                {
                  $addFields: {
                    yearMonth: {
                      $dateToString: {
                        format: "%Y-%m",
                        date: { $dateFromString: { dateString: "$date" } }
                      }
                    }
                  }
                },
                {
                  $group: {
                    _id: {
                      playerId: "$playerId",
                      yearMonth: "$yearMonth"
                    },
                    totalLoss: { $sum: "$loss" }
                  }
                },
                {
                  $match: {
                    totalLoss: { $gte: amount }
                  }
                },
                {
                  $lookup: {
                    from: "player",
                    localField: "_id.playerId",
                    foreignField: "_id",
                    as: "playerInfo"
                  }
                },
                { $unwind: "$playerInfo" },
                {
                  $project: {
                    username: "$playerInfo.username",
                    email: "$playerInfo.email",
                    date: "$_id.yearMonth",
                    amount: "$totalLoss"
                  }
                },
                {
                  $sort: {
                    date: -1  // -1 for descending order
                  }
                }
              ];
            }
            // console.log("pipeline",JSON.stringify(pipeline,null,2));
            playersData = await Sys.App.Services.transactionServices.getDataByAggre(pipeline);
            // console.log("playersData:-", playersData);
        }
        
        // console.log('playersData',JSON.stringify(playersData,null,2));

        let obj = {
            'draw': req.query.draw,
            'recordsTotal': playersData?.length || 0,
            'recordsFiltered': playersData?.length || 0,
            'data': playersData || [],
        };
        console.log("data:::: getUserTransactionList:::::::::", obj)
        return res.send(obj);
      } catch (error) {
          console.log('Error in getUserTransactionList: ', error);
          return new Error(error);
      }
    }
}

async function getTheadField(id, translate) {
    const theadFieldMap = {
        1: [translate.user_name, translate.email, translate.amount, translate.action],
        2: [translate.user_name, translate.email, translate.amount, translate.action],
        3: [translate.user_name, translate.email, translate.amount, translate.action],
        4: [translate.user_name, translate.email, translate.amount, translate.action],
        5: [translate.user_name, translate.email, translate.amount, translate.action],
        6: [translate.user_name, translate.email, translate.amount, translate.action],
        7: [translate.user_name, translate.email, translate.risk_country],
        8: [translate.user_name, translate.email, translate.PEP],
        9: [translate.user_name, translate.email]
    };
    return theadFieldMap[id] || null;
}

async function getTheadViewField(id, translate) {
  const theadFieldMap = {
      1: [translate.user_name, translate.email, translate.date, translate.amount],
      2: [translate.user_name, translate.email, translate.date, translate.amount],
      3: [translate.user_name, translate.email, translate.date, translate.amount],
      4: [translate.user_name, translate.email, translate.date, translate.amount],
      5: [translate.user_name, translate.email, translate.date, translate.amount],
      6: [translate.user_name, translate.email, translate.date, translate.amount],
  };
  return theadFieldMap[id] || null;
}