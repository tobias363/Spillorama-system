const Sys = require('../../Boot/Sys');
const moment = require('moment');
const { default: mongoose } = require('mongoose');
const Timeout = require('smart-timeout');
const { translate } = require('../../Config/i18n');
const { updatePlayerHallSpendingData, checkGamePlayAtSameTimeForRefund } = require('../../gamehelper/all');
let subGames = [
    { gameName: "Tv Extra", ticketType: ['Small Yellow', 'Large Yellow'], WinningPatterns: ['Picture', 'Frame', 'Full House'] },
    { gameName: "Quick", ticketType: ['Small Yellow', 'Large Yellow'], WinningPatterns: ['Full House'] },
    { gameName: "Jackpot", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White', 'Small Purple', 'Large Purple'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Traffic Light", ticketType: ['Small Red', 'Small Yellow', 'Small Green'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Elvis", ticketType: ['Small Elvis1', 'Small Elvis2', 'Small Elvis3', 'Small Elvis4', 'Small Elvis5'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Wheel of Fortune", ticketType: ['Small Yellow', 'Large Yellow'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Treasure Chest", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Ball X 10", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Super Nils", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Oddsen 56", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House Within 56 Balls', 'Full House'] },
    { gameName: "Oddsen 57", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House Within 57 Balls', 'Full House'] },
    { gameName: "Oddsen 58", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House Within 58 Balls', 'Full House'] },
    { gameName: "Spillerness Spill", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Spillerness Spill 2", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Spillerness Spill 3", ticketType: ['Small Orange'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Innsatsen", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Mystery", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "500 Spillet", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "1000 Spillet", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "1500 Spillet", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "2000 Spillet", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "2500 Spillet", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "3000 Spillet", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "4000 Spillet", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "5000 Spillet", ticketType: ['Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
    { gameName: "Color Draft", ticketType: ['Small Yellow', 'Large Yellow', 'Small White', 'Large White'], WinningPatterns: ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Full House'] },
];

// let subGames = [
//     { "gameName": "Tv Extra", "ticketType": ["small_yellow", "large_yellow"], "WinningPatterns": ["picture", "frame", "full_house"] },
//     { "gameName": "Quick", "ticketType": ["small_yellow", "large_yellow"], "WinningPatterns": ["full_house"] },
//     { "gameName": "Jackpot", "ticketType": ["small_yellow", "large_yellow", "small_white", "large_white", "small_purple", "large_purple"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Traffic Light", "ticketType": ["small_red", "small_yellow", "small_green"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Elvis", "ticketType": ["small_elvis1", "small_elvis2", "small_elvis3", "small_elvis4", "small_elvis5"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Wheel of Fortune", "ticketType": ["small_yellow", "large_yellow"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Treasure Chest", "ticketType": ["small_yellow", "large_yellow", "small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Ball X 10", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Super Nils", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Oddsen 56", "ticketType": ["small_yellow", "large_yellow", "small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house_within_56_balls", "full_house"] },
//     { "gameName": "Oddsen 57", "ticketType": ["small_yellow", "large_yellow", "small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house_within_57_balls", "full_house"] },
//     { "gameName": "Oddsen 58", "ticketType": ["small_yellow", "large_yellow", "small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house_within_58_balls", "full_house"] },
//     { "gameName": "Spillerness Spill", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Spillerness Spill 2", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Spillerness Spill 3", "ticketType": ["small_orange"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Innsatsen", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Mystery", "ticketType": ["small_yellow", "large_yellow", "small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "500 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "1000 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "1500 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "2000 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "2500 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "3000 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "4000 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "5000 Spillet", "ticketType": ["small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] },
//     { "gameName": "Color Draft", "ticketType": ["small_yellow", "large_yellow", "small_white", "large_white"], "WinningPatterns": ["row_1", "row_2", "row_3", "row_4", "full_house"] }
// ]

const translations = {
    en: {
        "small_yellow": "Small Yellow",
        "large_yellow": "Large Yellow",
        "picture": "Picture",
        "frame": "Frame",
        "full_house": "Full House",
        "small_white": "Small White",
        "large_white": "Large White",
        "small_purple": "Small Purple",
        "large_purple": "Large Purple",
        "row_1": "Row 1",
        "row_2": "Row 2",
        "row_3": "Row 3",
        "row_4": "Row 4",
        "small_red": "Small Red",
        "small_green": "Small Green",
        "small_elvis1": "Small Elvis 1",
        "small_elvis2": "Small Elvis 2",
        "small_elvis3": "Small Elvis 3",
        "small_elvis4": "Small Elvis 4",
        "small_elvis5": "Small Elvis 5",
        "full_house_within_56_balls": "Full House Within 56 Balls",
        "full_house_within_57_balls": "Full House Within 57 Balls",
        "full_house_within_58_balls": "Full House Within 58 Balls",
        "small_orange": "Small Orange"
    },
    no: {
        "small_yellow": "Liten Gul",
        "large_yellow": "Stor Gul",
        "picture": "Bilde",
        "frame": "Ramme",
        "full_house": "Fullt Hus",
        "small_white": "Liten Hvit",
        "large_white": "Stor Hvit",
        "small_purple": "Liten Lilla",
        "large_purple": "Stor Lilla",
        "row_1": "Rad 1",
        "row_2": "Rad 2",
        "row_3": "Rad 3",
        "row_4": "Rad 4",
        "small_red": "Liten Rød",
        "small_green": "Liten Grønn",
        "small_elvis1": "Liten Elvis 1",
        "small_elvis2": "Liten Elvis 2",
        "small_elvis3": "Liten Elvis 3",
        "small_elvis4": "Liten Elvis 4",
        "small_elvis5": "Liten Elvis 5",
        "full_house_within_56_balls": "Fullt Hus Innen 56 Kuler",
        "full_house_within_57_balls": "Fullt Hus Innen 57 Kuler",
        "full_house_within_58_balls": "Fullt Hus Innen 58 Kuler",
        "small_orange": "Liten Oransje"
    }

};


module.exports = {
    schedules: async function (req, res) {
        try {
            let addFlag = true;
            let editFlag = true;
            let viewFlag = true;
            let deleteFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Schedule Management'] || [];
                let stringReplace =req.session.details.isPermission['Schedule Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Schedule Management'];
                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
            }
            let keys = [
                "schedules_management",
                "dashboard",
                "schedulet",
                "schedules",
                "create_schedule",
                "schedules_id",
                "schedules_name",
                "schedules_type",
                "total_number_of_games_added_in_scheduler",
                "start_time",
                "end_time",
                "action",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_scheduler",
                "you_will_not_be_able_to_recover_this_schedule",
                "delete_button",
                "cancel_button",
                "deleted",
                "schedules_has_been_deleted",
                "cancelled",
                "delete_action_has_been_cancelled",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "all"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ScheduleManagement: 'active',
                addSlug: addFlag,
                viewSlug: viewFlag,
                editSlug: editFlag,
                deleteSlug: deleteFlag,
                schedules: translate,
                navigation: translate
            };
            return res.render('schedules/schedule', data);
        } catch (error) {
            Sys.Log.error('Error in schedules: ', error);
            return new Error(error);
        }
    },

    getSchedules: async function (req, res) {
        try {
            let sort = { createdAt: -1 };
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                query.$or = [{ scheduleNumber: { $regex: `.*${search}.*`, $options: 'i' } }, { scheduleName: { $regex: `.*${search}.*`, $options: 'i' } }]
            }

            if (req.query.type && (req.query.type == "Auto" || req.query.type == "Manual")) {
                query.scheduleType = req.query.type;
            }

            if (req.session.details.role == 'agent') {
               // query.$or = [{ createrId: req.session.details.id }, { isAdminSchedule: true }];
                // If $or already exists (from search), merge with existing $or
                if (query.$or) {
                    query.$and = [
                        { $or: query.$or },
                        {
                            $or: [
                                { createrId: req.session.details.id },
                                { isAdminSchedule: true }
                            ]
                        }
                    ];
                    delete query.$or; // Clean up top-level $or
                } else {
                    query.$or = [
                        { createrId: req.session.details.id },
                        { isAdminSchedule: true }
                    ];
                }

            }
            let reqCount = await Sys.App.Services.scheduleServices.getSchedulesCount(query);

            let data = await Sys.App.Services.scheduleServices.getSchedulesByData(query, {}, { sort: sort, limit: length, skip: start });

            let gameData = [];
            for (let i = 0; i < data.length; i++) {
                let startDate = data[i].manualStartTime;
                let endDate = data[i].manualEndTime;
                if (data[i].scheduleType == "Auto") {
                    startDate = data[i].subGames[0].start_time;
                    endDate = data[i].subGames[data[i].subGames.length - 1].end_time;
                }
                
                let dataGame = {
                    _id: data[i]._id,
                    scheduleNumber: data[i].scheduleNumber,
                    scheduleName: data[i].scheduleName,
                    scheduleType: data[i].scheduleType,
                    totalGames: data[i].subGames.length,
                    startDate: startDate,
                    endDate: endDate,
                    status: data[i].status,
                    isAdminSchedule: data[i].isAdminSchedule
                }
                gameData.push(dataGame);
            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in getSchedules", e);
            return new Error(e);
        }
    },

    createSchedule: async function (req, res) {
        try {
            let keys = [
                "schedules_management",
                "dashboard",
                "create_schedule",
                "edit_schedule",
                "schedules_name",
                "prize_of_lucky_number",
                "schedules_type",
                "auto",
                "manual",
                "start_time",
                "select",
                "end_time",
                "select_sub_game",
                "end_time_put_end_time_if_this_is_your_lasr_game",
                "custom_game_name",
                "custom_game_name_is_required",
                "notification_start_time",
                "minimum_seconds_to_display_single",
                "maximum_seconds_to_display_single",
                "total_second_to_display_single_ball",
                "ticket_color_type_price",
                "small_red",
                "small_yellow",
                "small_green",
                "elvis1",
                "elvis2",
                "elvis3",
                "elvis4",
                "elvis5",
                "row_pattern_price",
                "prize",
                "column",
                "jackpot_prize_and_draw",
                "price_to_replace_elvis_tickets",
                "jackpot_draw",
                "cancel",
                "row_pattern_prize_percentage_must_be_less_or_equal_to_100",
                "minimum_seconds_to_display_single_ball",
                "maximum_seconds_to_display_single_ball",
                "total_second_to_display_single_ball",
                "row_pattern",
                "jackpot_prize_draws",
                "row_attern_prize",
                "start_time_must_be_less_than_end_time",
                "start_time_must_be_greater_than_previous_game_start_time",
                "are_you_sure_this_is_the_last_game",
                "all_the_listed_upcoming_games_will_be_removed",
                "end_time_must_be_greater_than_start_time",
                "minimum_seconds_must_be_greater_than_3",
                "minsecond_muts_be_less_than_maxsecond",
                "maxsecond_muts_be_greater_than_minsecond",
                "please_enter_ticket_price",
                "please_add_atleast_one_game",
                "please_enter_the_end_time_if_this_is_your_last_game_for_the_schedule",
                "small_yellow",
                "large_yellow",
                "picture",
                "frame",
                "full_house",
                "small_white",
                "large_white",
                "small_purple",
                "large_purple",
                "row_1",
                "row_2",
                "row_3",
                "row_4",
                "small_red",
                "small_green",
                "small_elvis1",
                "small_elvis2",
                "small_elvis3",
                "small_elvis4",
                "small_elvis5",
                "full_house_within_56_balls",
                "full_house_within_57_balls",
                "full_house_within_58_balls",
                "small_orange",
                "jackpot_prize_must_between_5k_50k",
                "jackpot_draw_between_50_57",
                "jackpot_draw_between_55_59",
                "store_schedule",
                "store_sub_game",
                "add_game",
                "update",
                "submit"
            ]

            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            // let lang = req.session.details.language == 'english' ? 'en' : 'no'
            // let subGamesData = translateSubGames(subGames, lang)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ScheduleManagement: 'active',
                subGameList: subGames, //subGamesData,
                slug: 'Add',
                schedules: translate,
                navigation: translate

            };
            return res.render('schedules/create', data);
        } catch (error) {
            Sys.Log.error('Error in createSchedule: ', error);
            return new Error(error);
        }
    },

    createSchedulePostData: async function (req, res) {
        try {
            console.log("createSchedulePostData: ", req.body, req.body.subGame[0].ticketColorType, req.body.subGame[0].ticketColorTypePrice, req.body.subGame[0].prize);
            console.log("req.body.subGame", JSON.stringify(req.body.subGame, null, 2));
            let subgames = [];
            let startTime = [];
            if (req.body.subGame.length > 0) {
                for (let i = 0; i < req.body.subGame.length; i++) {
                    let ticketTypeObj = { ticketType: [], ticketPrice: [], ticketPrize: [], options: [] };
                    let ticketType = req.body.subGame[i].ticketColorType;
                    let ticketPrice = req.body.subGame[i].ticketColorTypePrice;
                    let ticketPrize = req.body.subGame[i].prize;
                    let minimumWinningPrize = {};
                    if (req.body.subGame[i].name == "Spillerness Spill" || req.body.subGame[i].name == "Spillerness Spill 2") {
                        minimumWinningPrize = req.body.subGame[i].minimumPrize;
                    }
                    console.log("ticketPrize", ticketPrize, minimumWinningPrize)
                    if (ticketType.length > 0) {
                        ticketTypeObj.ticketType = ticketType;
                        for (let t = 0; t < ticketType.length; t++) {
                            //console.log("ticket---",ticketType[t], ticketType[t].slice(6), ticketPrice,   ticketPrice[0][ticketType[t]], ticketPrize[ticketType[t].slice(6)])
                            //ticketTypeObj.ticketPrice.push({[ticketType[t]]: ( ticketPrice[0][ticketType[t]] != "" ?  + ticketPrice[0][ticketType[t]] : 0)  })
                            //ticketTypeObj.ticketPrize.push({[ticketType[t]]: ticketPrize[ticketType[t].slice(6)] })

                            let priceTemp = (ticketPrice[0][ticketType[t]] != "" ? + ticketPrice[0][ticketType[t]] : 0)
                            if (req.body.subGame[i].name == "Traffic Light" || req.body.subGame[i].name == "Elvis") {
                                priceTemp = ticketPrice[0][ticketType[0]];
                            }
                            ticketTypeObj.ticketPrice.push({ name: ticketType[t], price: priceTemp })
                            ticketTypeObj.ticketPrize.push({ name: ticketType[t], prize: ticketPrize[ticketType[t].slice(6)], minimumPrize: minimumWinningPrize[ticketType[t].slice(6)] })
                            ticketTypeObj.options.push({ ticketName: ticketType[t], ticketPrice: priceTemp, winning: ticketPrize[ticketType[t].slice(6)], totalPurchasedTickets: 0, minimumWinning: minimumWinningPrize[ticketType[t].slice(6)] })
                        }
                    }
                    //console.log("ticketTypeObj", ticketTypeObj);

                    /*let startTimeTemp = req.body.subGame[i].start_time.split(":");
                    startTimeTemp = (+startTimeTemp[0]) * 60 + (+startTimeTemp[1]);
                    let result = startTime.every(function (e) {
                        return e < startTimeTemp;
                    });

                    if(result == true){
                        startTime.push(startTimeTemp);
                    }else{
                        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                        return res.redirect('/schedules');
                    }*/

                    let jackpotPrize = 0;
                    let jackpotDraw = 0;
                    if (req.body.subGame[i].name == "Jackpot") {
                        //jackpotPrize = req.body.subGame[i].jackpotPrize;
                        jackpotPrize = {
                            'white': req.body.subGame[i].jackpotPrizeWhite,
                            'yellow': req.body.subGame[i].jackpotPrizeYellow,
                            'purple': req.body.subGame[i].jackpotPrizePurple
                        }
                        jackpotDraw = req.body.subGame[i].jackpotDraw;
                    }
                    let replaceTicketPrice = 0;
                    if (req.body.subGame[i].name == "Elvis") {
                        replaceTicketPrice = req.body.subGame[i].replace_price;
                    }
                    if (req.body.subGame[i].name == "Innsatsen") {
                        jackpotDraw = req.body.subGame[i].jackpotInnsatsenDraw;
                    }
                    subgames.push({
                        name: req.body.subGame[i].name,
                        custom_game_name: req.body.subGame[i].custom_game_name,
                        start_time: req.body.subGame[i].start_time,
                        end_time: req.body.subGame[i].end_time,
                        notificationStartTime: req.body.subGame[i].notificationStartTime,
                        minseconds: req.body.subGame[i].minseconds,
                        maxseconds: req.body.subGame[i].maxseconds,
                        seconds: req.body.subGame[i].seconds,
                        ticketTypesData: ticketTypeObj,
                        jackpotData: { jackpotPrize: jackpotPrize, jackpotDraw: jackpotDraw },
                        elvisData: { replaceTicketPrice: replaceTicketPrice }
                    })
                }

            } else {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["pls_add_atleast_one_subgame"], req.session.details.language));
                return res.redirect('/createSchedule');
            }
            let autoGameStartTime = "";
            let autoGameEndTime = "";
            if (req.body.scheduleType == "Auto" && subgames.length > 0) {
                autoGameStartTime = subgames[0].start_time;
                autoGameEndTime = subgames[(subgames.length - 1)].end_time;
            }
            let currentDate = Date.now()
            let scheduleNumber = dateTimeFunction(currentDate);
            let schedule = await Sys.App.Services.scheduleServices.insertSchedulesData({
                createrId: req.session.details.id,
                isAdminSchedule: (req.session.details.role == 'agent') ? false : true,
                scheduleName: req.body.scheduleName,
                scheduleType: req.body.scheduleType,
                scheduleNumber: 'SID_' + scheduleNumber,
                luckyNumberPrize: req.body.luckyNumberPrize,
                status: "active",
                manualStartTime: (req.body.manualStartTime) ? req.body.manualStartTime : autoGameStartTime,
                manualEndTime: (req.body.manualEndTime) ? req.body.manualEndTime : autoGameEndTime,
                subGames: subgames,
            });

            if (!schedule) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/schedules');
            } else {
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["schedule_create_successfully"], req.session.details.language));
                return res.redirect('/schedules');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    editSchedule: async function (req, res) {
        try {
            let keys = [
                "end_time_(put_end_time_if_this_is_your_lasr_game)",
                "custom_game_name",
                "custom_game_name_is_required",
                "notification_start_time",
                "minimum_seconds_to_display_single",
                "maximum_seconds_to_display_single",
                "total_second_to_display_single_ball",
                "ticket_color_type_price",
                "row_pattern_price",
                "dashboard",
                "create_schedule",
                "edit_schedule",
                "schedules_name",
                "prize_of_lucky_number",
                "schedules_type",
                "auto",
                "manual",
                "start_time",
                "select",
                "end_time",
                "select_sub_game",
                "end_time_put_end_time_if_this_is_your_lasr_game",
                "small_red",
                "small_yellow",
                "small_green",
                "elvis1",
                "elvis2",
                "elvis3",
                "elvis4",
                "elvis5",
                "prize",
                "column",
                "jackpot_prize_and_draw",
                "price_to_replace_elvis_tickets",
                "jackpot_draw",
                "cancel",
                "row_pattern_prize_percentage_must_be_less_or_equal_to_100",
                "minimum_seconds_to_display_single_ball",
                "maximum_seconds_to_display_single_ball",
                "total_second_to_display_single_ball",
                "row_pattern",
                "jackpot_prize_draws",
                "row_attern_prize",
                "start_time_must_be_less_than_end_time",
                "start_time_must_be_greater_than_previous_game_start_time",
                "are_you_sure_this_is_the_last_game",
                "all_the_listed_upcoming_games_will_be_removed",
                "end_time_must_be_greater_than_start_time",
                "minimum_seconds_must_be_greater_than_3",
                "please_enter_ticket_price",
                "please_add_atleast_one_game",
                "please_enter_the_end_time_if_this_is_your_last_game_for_the_schedule",
                "jackpot_prize_must_between_5k_50k",
                "jackpot_draw_between_50_57",
                "jackpot_draw_between_55_59",
                "store_schedule",
                "minsecond_muts_be_less_than_maxsecond",
                "maxsecond_muts_be_greater_than_minsecond",
                "store_sub_game",
                "add_game",
                "update",
                "submit",
                "full_house",
                "row_1",
                "row_2",
                "row_3",
                "row_4",
                "full_house_within_56_balls",
                "full_house_within_57_balls",
                "full_house_within_58_balls",
                "picture",
                "frame"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let schedule = await Sys.App.Services.scheduleServices.getSingleSchedulesData({ _id: req.params.id }, {}, {});
            // console.log(schedule.subGames[0].ticketTypesData.ticketPrice)
            // let lang = req.session.details.language == 'english' ? 'en' : 'no'
            // let subGamesData = translateSubGames(subGames, lang)
            if(!schedule){
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/schedules');
            }
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ScheduleManagement: 'active',
                schedule: schedule,
                subGameList: subGames, // subGamesData,
                totalSubGamesCount: schedule?.subGames?.length,
                slug: 'Edit',
                schedules: translate,
                navigation: translate
            };
            return res.render('schedules/create', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editSchedulePostData: async function (req, res) {
        try {
            //console.log("createSchedulePostData: ", req.body, req.body.subGame[0].ticketColorType, req.body.subGame[0].ticketColorTypePrice);
            //console.log("createSchedulePostData: ", req.body.subGame[0].ticketColorType, );

            //console.log("prize: ", req.body.subGame[0].prize);

            let subgames = [];
            if (req.body.subGame.length > 0) {
                for (let i = 0; i < req.body.subGame.length; i++) {
                    let ticketTypeObj = { ticketType: [], ticketPrice: [], ticketPrize: [], options: [] };
                    let ticketType = req.body.subGame[i].ticketColorType;
                    let ticketPrice = req.body.subGame[i].ticketColorTypePrice;
                    let ticketPrize = req.body.subGame[i].prize;
                    let minimumWinningPrize = {};
                    if (req.body.subGame[i].name == "Spillerness Spill" || req.body.subGame[i].name == "Spillerness Spill 2") {
                        minimumWinningPrize = req.body.subGame[i].minimumPrize;
                    }
                    if (ticketType.length > 0) {
                        ticketTypeObj.ticketType = ticketType;
                        for (let t = 0; t < ticketType.length; t++) {
                            //console.log("ticket---",ticketType[t], ticketPrice,   ticketPrice[0][ticketType[t]], ticketPrize[ticketType[t].slice(6)])
                            //ticketTypeObj.ticketPrice.push({[ticketType[t]]: ( ticketPrice[0][ticketType[t]] != "" ?  + ticketPrice[0][ticketType[t]] : 0)  })
                            //ticketTypeObj.ticketPrize.push({[ticketType[t]]: ticketPrize[ticketType[t].slice(6)] })
                            let priceTemp = (ticketPrice[0][ticketType[t]] != "" ? + ticketPrice[0][ticketType[t]] : 0)
                            if (req.body.subGame[i].name == "Traffic Light" || req.body.subGame[i].name == "Elvis") {
                                priceTemp = ticketPrice[0][ticketType[0]];
                            }
                            ticketTypeObj.ticketPrice.push({ name: ticketType[t], price: priceTemp })
                            ticketTypeObj.ticketPrize.push({ name: ticketType[t], prize: ticketPrize[ticketType[t].slice(6)], minimumPrize: minimumWinningPrize[ticketType[t].slice(6)] })
                            ticketTypeObj.options.push({ ticketName: ticketType[t], ticketPrice: priceTemp, winning: ticketPrize[ticketType[t].slice(6)], totalPurchasedTickets: 0, minimumWinning: minimumWinningPrize[ticketType[t].slice(6)] })
                        }
                    }
                    //console.log("ticketTypeObj", ticketTypeObj)

                    let jackpotPrize = 0;
                    let jackpotDraw = 0;
                    if (req.body.subGame[i].name == "Jackpot") {
                        //jackpotPrize = req.body.subGame[i].jackpotPrize;
                        jackpotPrize = {
                            'white': req.body.subGame[i].jackpotPrizeWhite,
                            'yellow': req.body.subGame[i].jackpotPrizeYellow,
                            'purple': req.body.subGame[i].jackpotPrizePurple
                        }
                        jackpotDraw = req.body.subGame[i].jackpotDraw;
                    }
                    let replaceTicketPrice = 0;
                    if (req.body.subGame[i].name == "Elvis") {
                        replaceTicketPrice = req.body.subGame[i].replace_price;
                    }
                    if (req.body.subGame[i].name == "Innsatsen") {
                        jackpotDraw = req.body.subGame[i].jackpotInnsatsenDraw;
                    }
                    subgames.push({
                        name: req.body.subGame[i].name,
                        custom_game_name: req.body.subGame[i].custom_game_name,
                        start_time: req.body.subGame[i].start_time,
                        end_time: req.body.subGame[i].end_time,
                        notificationStartTime: req.body.subGame[i].notificationStartTime,
                        minseconds: req.body.subGame[i].minseconds,
                        maxseconds: req.body.subGame[i].maxseconds,
                        seconds: req.body.subGame[i].seconds,
                        ticketTypesData: ticketTypeObj,
                        jackpotData: { jackpotPrize: jackpotPrize, jackpotDraw: jackpotDraw },
                        elvisData: { replaceTicketPrice: replaceTicketPrice }
                    })
                }

            } else {
                // req.flash('success', 'Please add atleast one Subgame.');
                // return res.redirect('/createSchedule');
            }
            let manualStartTime = "";
            let manualEndTime = "";
            let scheduleData = await Sys.App.Services.scheduleServices.getSingleSchedulesData({ _id: req.params.id }, { scheduleType: 1 }, {});
            if (scheduleData.scheduleType == "Auto" && subgames.length > 0) {
                manualStartTime = subgames[0].start_time;
                manualEndTime = subgames[(subgames.length - 1)].end_time;
            } else {
                manualStartTime = (req.body.manualStartTime) ? req.body.manualStartTime : "",
                    manualEndTime = (req.body.manualEndTime) ? req.body.manualEndTime : "";
            }

            let schedule = await Sys.App.Services.scheduleServices.updateSchedulesData({ _id: req.params.id }, {
                scheduleName: req.body.scheduleName,
                luckyNumberPrize: req.body.luckyNumberPrize,
                status: "active",
                subGames: subgames,
                manualStartTime: manualStartTime,//(req.body.manualStartTime) ? req.body.manualStartTime: autoGameStartTime,
                manualEndTime: manualEndTime //(req.body.manualEndTime) ? req.body.manualEndTime: autoGameEndTime,
            });

            if (!schedule) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/editSchedule/' + req.params.id);
            } else {
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["schedule_updated_successfully"], req.session.details.language));
                return res.redirect('/schedules');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteSchedule: async function (req, res) {
        try {
            let schedule = await Sys.App.Services.scheduleServices.getSingleSchedulesData({ _id: req.body.id });
            if (schedule || schedule.length > 0) {
                await Sys.App.Services.scheduleServices.deleteSchedule({ _id: req.body.id });
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewSchedule: async function (req, res) {
        try {
            let keys = [
                "schedules_management",
                "dashboard",
                "view_scheduler",
                "schedules_name",
                "prize_of_lucky_number",
                "schedules_type",
                "auto",
                "manual",
                "start_time",
                "end_time",
                "select_sub_game",
                "end_time_put_ent_time_if_this_is_your_last_game",
                "notification_start_time",
                "minimum_seconds_to_display_single",
                "maximum_seconds_to_display_single",
                "total_second_to_display_single_ball",
                "ticket_colr_type_and_price",
                "row_pattern_price",
                "prize",
                "jackpot_prize_and_drwa",
                "prize_to_replace_elvis_tickets",
                "jackpot_draw",
                "cancel",
                "schedules_management",
                "dashboard",
                "create_schedule",
                "edit_schedule",
                "schedules_name",
                "prize_of_lucky_number",
                "schedules_type",
                "auto",
                "manual",
                "start_time",
                "select",
                "end_time",
                "select_sub_game",
                "end_time_(put_end_time_if_this_is_your_lasr_game)",
                "custom_game_name",
                "notification_start_time",
                "minimum_seconds_to_display_single",
                "maximum_seconds_to_display_single",
                "total_second_to_display_single_ball",
                "ticket_color_type_price",
                "small_red",
                "small_yellow",
                "small_green",
                "elvis1",
                "elvis2",
                "elvis3",
                "elvis4",
                "elvis5",
                "prize",
                "column",
                "jackpot_prize_and_draw",
                "price_to_replace_elvis_tickets",
                "jackpot_draw",
                "cancel",
                "row_pattern_prize_percentage_must_be_less_or_equal_to_100",
                "minimum_seconds_to_display_single_ball",
                "maximum_seconds_to_display_single_ball",
                "total_second_to_display_single_ball",
                "row_pattern",
                "jackpot_prize_draws",
                "row_attern_prize",
                "start_time_must_be_less_than_end_time",
                "start_time_must_be_greater_than_previous_game_start_time",
                "are_you_sure_this_is_the_last_game",
                "all_the_listed_upcoming_games_will_be_removed",
                "end_time_must_be_greater_than_start_time",
                "minimum_seconds_must_be_greater_than_3",
                "please_enter_ticket_price",
                "please_add_atleast_one_game",
                "please_enter_the_end_time_if_this_is_your_last_game_for_the_schedule",
                "full_house",
                "row_1",
                "row_2",
                "row_3",
                "row_4",
                "full_house_within_56_balls",
                "full_house_within_57_balls",
                "full_house_within_58_balls",
                "picture",
                "frame"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let schedule = await Sys.App.Services.scheduleServices.getSingleSchedulesData({ _id: req.params.id }, {}, {});

            // let lang = req.session.details.language == 'english' ? 'en' : 'no'
            // let subGamesData = translateSubGames(subGames, lang)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                ScheduleManagement: 'active',
                schedule: schedule,
                subGameList: subGames,  //subGamesData,
                totalSubGamesCount: schedule.subGames.length,
                slug: 'view',
                schedules: translate,
                navigation: translate
            };
            return res.render('schedules/view', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    createDailySchedule: async function (req, res) {
        try {
            let keys = [
                "daily_schedule_management",
                "dashboard",
                "create_daily_schedule",
                "save_game",
                "save_as",
                "enter_name_of_daily_schedule",
                "please",
                "save",
                "start_date",
                "end_date",
                "select_time_slot",
                "select_weekdays",
                "select_schedule_for_each_weeday",
                "select_schedule",
                "select_group_of_halls",
                "select_halls",
                "select_master_hall",
                "submit",
                "cancel",
                "created",
                "error",
                "daily_schedule_aved_success",
                "minimum_1_day_gap"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            if (req.params.id) {
                let gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
                if (gameType.type == 'game_1') {
                    let schedule = await Sys.App.Services.scheduleServices.getSchedulesByData({}, { scheduleName: 1, manualStartTime: 1, manualEndTime: 1 }, {});
                    let allTimeSlots = [];
                    if (schedule.length > 0) {
                        for (let s = 0; s < schedule.length; s++) {
                            if (schedule[s].manualStartTime != "" && schedule[s].manualEndTime != "") {
                                allTimeSlots.push({ startTime: schedule[s].manualStartTime, endTime: schedule[s].manualEndTime });
                            }
                        }
                    }
                    //console.log("allTimeSlots", allTimeSlots);
                    let uniqueTimeSlots = allTimeSlots.filter((v, i, a) => a.findIndex(v2 => ['startTime', 'endTime'].every(k => v2[k] === v[k])) === i)
                    //console.log("allTimeSlots updated", uniqueTimeSlots)
                    let sortedTimeSlots = uniqueTimeSlots.sort((a, b) => a.startTime > b.startTime ? 1 : -1);
                    //console.log("allTimeSlots sorted", sortedTimeSlots)
                    let canSave = true;
                    if (req.session.details.role == 'agent') {
                        let stringReplace = req.session.details.isPermission['Save Game List'];
                        if (!stringReplace || stringReplace.indexOf("add") == -1) {
                            canSave = false;
                        }
                    }
                    let data = {
                        App: Sys.Config.App.details,
                        Agent: req.session.details,
                        error: req.flash("error"),
                        success: req.flash("success"),
                        GameManagement: 'active',
                        subGameList: schedule,
                        groupHallArray: [],
                        groupOfHallsIds: [],
                        allHalls: [],
                        slug: 'Add',
                        timeSlots: sortedTimeSlots,
                        canSave: canSave,
                        translate: translate,
                        navigation: translate
                    };
                    return res.render('dailySchedules/create', data);
                }
                return res.redirect('/gameManagement');
            }
            return res.redirect('/gameManagement');
        } catch (error) {
            Sys.Log.error('Error in create Daily Schedule: ', error);
            return new Error(error);
        }
    },

    createSpecailSchedule: async function (req, res) {
        try {
            let keys = [
                "special_schedule_management",
                "dashboard",
                "create_daily_schedule",
                "edit_daily_schedule",
                "save_game",
                "create_daily_schedule",
                "edit_daily_schedule",
                "select_time_slot",
                "select_time_slot",
                "select_schedule",
                "select_group_of_halls",
                "select_master_hall",
                "select_master_hall",
                "hall_is_already_designated_as_a_master_hall_in_the_normal_event_please_select_a_different_hall_or_change_the_setting",
                "cancel",
                "submit",
                "date",
                "select_halls"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            if (req.params.id) {
                let gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
                if (gameType.type == 'game_1') {
                    let schedule = await Sys.App.Services.scheduleServices.getSchedulesByData({}, { scheduleName: 1, manualStartTime: 1, manualEndTime: 1 }, {});
                    let allTimeSlots = [];
                    if (schedule.length > 0) {
                        for (let s = 0; s < schedule.length; s++) {
                            if (schedule[s].manualStartTime != "" && schedule[s].manualEndTime != "") {
                                allTimeSlots.push({ startTime: schedule[s].manualStartTime, endTime: schedule[s].manualEndTime });
                            }
                        }
                    }
                    //console.log("allTimeSlots", allTimeSlots);
                    let uniqueTimeSlots = allTimeSlots.filter((v, i, a) => a.findIndex(v2 => ['startTime', 'endTime'].every(k => v2[k] === v[k])) === i)
                    //console.log("allTimeSlots updated", uniqueTimeSlots)
                    let sortedTimeSlots = uniqueTimeSlots.sort((a, b) => a.startTime > b.startTime ? 1 : -1);
                    //console.log("allTimeSlots sorted", sortedTimeSlots)
                    let canSave = true;
                    if (req.session.details.role == 'agent') {
                        let stringReplace = req.session.details.isPermission['Save Game List'];
                        if (!stringReplace || stringReplace.indexOf("add") == -1) {
                            canSave = false;
                        }
                    }
                    let data = {
                        App: Sys.Config.App.details,
                        Agent: req.session.details,
                        error: req.flash("error"),
                        success: req.flash("success"),
                        GameManagement: 'active',
                        subGameList: schedule,
                        groupHallArray: [],
                        groupOfHallsIds: [],
                        allHalls: [],
                        slug: 'Add',
                        timeSlots: sortedTimeSlots,
                        canSave: canSave,
                        translate: translate,
                        navigation: translate

                    };
                    return res.render('dailySchedules/createSpecialSchedules', data);
                }
                return res.redirect('/gameManagement');
            }
            return res.redirect('/gameManagement');
        } catch (error) {
            Sys.Log.error('Error in create Daily Schedule: ', error);
            return new Error(error);
        }
    },

    getAvailableGroupHallsOld: async function (req, res) {
        try {
            console.log("Dates", req.query, req.params);
            let startDate = req.query.startDate;
            let endDate = req.query.endDate;
            let data = [];
            let groupHallsAvailable = [];
            if (req.params.type.length == 0) {
                return res.send({
                    "status": "fail",
                    "message": await Sys.Helper.bingo.getSingleTraslateData(["game_type_not_found"], req.session.details.language),
                    "groupHalls": []
                });
            }
            if (startDate !== '' && endDate !== '') {
                startDate = new Date(startDate);
                endDate = new Date(endDate);
                //Getting GroupHalls of all actvie and running games satisfying query condition
                let dataQuery = {
                    "status": { "$in": ['running', 'active'] },
                    "stopGame": false,
                    "$or": [
                        { startDate: { $gte: startDate, $lte: endDate } },
                        { endDate: { $gte: startDate, $lte: endDate } }
                    ]
                    // "$or": [{
                    //     "startDate": { "$gte": startDate },
                    //     "endDate": { "$lte": endDate }
                    // }, {
                    //     "startDate": { "$lte": endDate },
                    //     "endDate": { "$gte": endDate }
                    // }]
                }
                console.log("Query for date search", JSON.stringify(dataQuery));
                data = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {
                    _id: 0,
                    groupHalls: 1
                });
                console.log("data 1", data);

                if (data.length) {
                    let uniqueId = [];
                    for (let i = 0; i < data.length; i++) {
                        const element = data[i].groupHalls;
                        for (let j = 0; j < element.length; j++) {
                            uniqueId.push(element[j].id);
                        }
                    }
                    data = uniqueId.filter((v, i, a) => a.indexOf(v) === i);
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ _id: { "$nin": data }, status: "active" }, { name: 1, halls: 1 });
                    console.log("groupHallsAvailable", groupHallsAvailable);
                } else {
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ "status": "active" }, { name: 1, halls: 1 });
                }
            }
            console.log("groupHallsAvailable", groupHallsAvailable)
            let allHalls = [];
            if (groupHallsAvailable.length > 0) {
                for (let i = 0; i < groupHallsAvailable.length; i++) {
                    console.log(groupHallsAvailable[i])
                    if (groupHallsAvailable[i].halls.length > 0) {
                        let groupHalls = []
                        for (let j = 0; j < groupHallsAvailable[i].halls.length; j++) {
                            if (groupHallsAvailable[i].halls[j].status == "active") {
                                groupHalls.push(groupHallsAvailable[i].halls[j])
                                allHalls.push(groupHallsAvailable[i].halls[j])
                            }
                        }
                        groupHallsAvailable[i].halls = groupHalls;
                    }

                }
            }
            return res.send({
                "status": "success",
                "groupHalls": { groupHallsAvailable: groupHallsAvailable, allHalls: allHalls }
            });
        } catch (e) {
            console.log("Error in getAvailable GroupHalls", e);
            return res.send({
                "status": "fail",
                "groupHalls": []
            });
        }
    },

    getAvailableGroupHalls: async function (req, res) {
        try {
            console.log("Dates", req.query, req.params);
            let startDate = req.query.startDate;
            let endDate = req.query.endDate;

            if (req.params.type.length == 0) {
                return res.send({
                    "status": "fail",
                    "message": await Sys.Helper.bingo.getSingleTraslateData(["game_type_not_found"], req.session.details.language),
                    "groupHalls": []
                });
            }

            if (req.query.scheduleId && req.query.scheduleId != "") {
                let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.query.scheduleId }, {}, {});
                console.log("schedule", schedule)
                if (startDate !== '' && endDate !== '') { // || (startDate < schedule.startDate && endDate < schedule.startDate)
                    let stDate = new Date(startDate);
                    let scheduleStartDate = new Date(schedule.endDate);
                    let enDate = new Date(endDate);
                    let scheduleEndDate = new Date(schedule.endDate);
                    console.log("dates", startDate, scheduleStartDate, endDate)
                    if ((stDate > scheduleStartDate && enDate > scheduleEndDate)

                    ) {
                        console.log("in if")

                        let groupHalls = {};
                        if (startDate !== '' && endDate !== '') {
                            halls = await module.exports.findAvailableHalls(req.session.details, startDate, endDate);
                            console.log("available halls---", halls)
                            if (halls.status == "success") {
                                groupHalls = halls.groupHalls
                            }
                        }

                        return res.send({
                            "status": "success",
                            "groupHalls": groupHalls
                        });

                    } else {

                        console.log("in else")
                        let availHalls = await module.exports.findAvailableHallForEdit(req.query.scheduleId)
                        console.log("availHalls", availHalls)
                        if (availHalls.status == "success") {

                            let groupOfHallsTemp = availHalls.groupHalls.groupOfHalls;
                            let allHalls = availHalls.groupHalls.allHalls;
                            let groupOfHalls = [];
                            if (groupOfHallsTemp.length > 0) {
                                for (let g = 0; g < groupOfHallsTemp.length; g++) {
                                    groupOfHalls.push({
                                        _id: groupOfHallsTemp[g].id,
                                        name: groupOfHallsTemp[g].name,
                                        halls: groupOfHallsTemp[g].halls,
                                    })
                                }
                            }
                            return res.send({
                                "status": "success",
                                "groupHalls": { groupHallsAvailable: groupOfHalls, allHalls: allHalls }
                            });
                        }


                    }
                }
            } else {
                let groupHalls = {};
                if (startDate !== '' && endDate !== '') {
                    halls = await module.exports.findAvailableHalls(req.session.details, startDate, endDate);
                    console.log("available halls---", halls)
                    if (halls.status == "success") {
                        groupHalls = halls.groupHalls
                    }
                }

                return res.send({
                    "status": "success",
                    "groupHalls": groupHalls
                });
            }


        } catch (e) {
            console.log("Error in getAvailable GroupHalls", e);
            return res.send({
                "status": "fail",
                "groupHalls": {}
            });
        }
    },

    findAvailableHalls: async function (user, startDate, endDate) {
        try {
            console.log("USER ROLE", user.role);
            let data = [];
            let occupiedGroupOfHalls = [];
            let groupHallsAvailable = [];
            if (startDate !== '' && endDate !== '') {
                startDate = new Date(startDate);
                endDate = new Date(endDate);
                //Getting GroupHalls of all actvie and running games satisfying query condition
                let dataQuery = {
                    "status": { "$in": ['running', 'active'] },
                    "stopGame": false,
                    "startDate": { $lte: endDate },
                    "endDate": { $gte: startDate },
                    "isSavedGame": false
                    // "$or": [ 
                    //     { startDate: { $gte: startDate, $lte: endDate  } }, 
                    //     { endDate: { $gte: startDate, $lte: endDate  }  } 
                    // ]
                }

                if (user.role == 'agent') {
                    dataQuery['allHallsId'] = user.hall[0].id;
                }
                console.log("Query for date search", JSON.stringify(dataQuery));
                data = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {
                    _id: 0,
                    groupHalls: 1
                });
                //console.log("data 1",data);
                if (data.length) {
                    let uniqueId = [];
                    for (let i = 0; i < data.length; i++) {
                        const element = data[i].groupHalls;
                        for (let j = 0; j < element.length; j++) {
                            uniqueId.push(element[j].id);
                            occupiedGroupOfHalls.push(element[j])
                        }
                    }
                    data = uniqueId.filter((v, i, a) => a.indexOf(v) === i);
                    let query = { _id: { "$nin": data }, status: "active" };
                    if (user.role == 'agent') {
                        query['halls.id'] = user.hall[0].id;
                    }
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData(query, { name: 1, halls: 1 });
                    //groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ "status":"active" }, { name: 1, halls: 1 });
                    //console.log("groupHallsAvailable", groupHallsAvailable);
                } else {
                    let query = {
                        "status": "active"
                    }
                    if (user.role == "agent") {
                        query['halls.id'] = user.hall[0].id;
                    }
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData(query, { name: 1, halls: 1 });
                }
            }
            //console.log("groupHallsAvailable", groupHallsAvailable)
            let allHalls = [];
            if (groupHallsAvailable.length > 0) {
                for (let i = 0; i < groupHallsAvailable.length; i++) {
                    console.log(groupHallsAvailable[i])
                    if (groupHallsAvailable[i].halls.length > 0) {
                        let groupHalls = []
                        for (let j = 0; j < groupHallsAvailable[i].halls.length; j++) {
                            if (groupHallsAvailable[i].halls[j].status == "active") {
                                groupHalls.push(groupHallsAvailable[i].halls[j])
                                allHalls.push(groupHallsAvailable[i].halls[j])
                            }
                        }
                        groupHallsAvailable[i].halls = groupHalls;
                    }

                }
            }

            //start occupiedGroupOfHalls
            //console.log("occupiedGroupOfHalls---", occupiedGroupOfHalls)
            const groupAndMerge = occupiedGroupOfHalls.reduce((ac, a) => {
                let temp = ac.find(x => x.id === a.id);
                if (!temp) ac.push({
                    ...a,
                    selectedHalls: [...a.selectedHalls]
                })
                else temp.selectedHalls.push(...a.selectedHalls)
                return ac;
            }, [])

            //console.log("grouped---",groupAndMerge);
            for (let g = 0; g < groupAndMerge.length; g++) {
                // console.log("halls", groupAndMerge[g].halls)
                let diff = groupAndMerge[g].halls.filter(o => !groupAndMerge[g].selectedHalls.some(v => v.id === o.id));
                //console.log("diff", diff)
                if (diff.length > 0) {
                    let isActive = false;
                    let groupOfActiveHalls = [];
                    for (d = 0; d < diff.length; d++) {
                        if (diff[d].status == "active") {
                            isActive = true;
                            allHalls.push(diff[d]);
                            groupOfActiveHalls.push(diff[d]);
                        }
                    }
                    if (isActive == true) {
                        groupHallsAvailable.push({ halls: groupOfActiveHalls, _id: groupAndMerge[g].id.toString(), name: groupAndMerge[g].name })
                    }
                }
            }
            //end  occupiedGroupOfHalls
            //console.log("available halls check conditions", {groupHallsAvailable: groupHallsAvailable, allHalls: allHalls })
            return {
                "status": "success",
                "groupHalls": { groupHallsAvailable: groupHallsAvailable, allHalls: allHalls }
            };
        } catch (e) {
            console.log(e);
            return {
                "status": "error",
                "groupHalls": {}
            };
        }
    },

    createDailySchedulePostData: async function (req, res) {
        try {
            console.log("createDailySchedulePostData: ", req.body);

            let timeSlot = req.body.timeSlot;
            let startTime = "";
            let endTime = "";
            if (timeSlot) {
                let times = timeSlot.split('-');
                startTime = times[0].trim();
                endTime = times[1].trim()
            }

            if (req.body.start_date == "" || req.body.end_date == "" || req.body.schedule.length <= 0 || req.body.masterhall == "") {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language));
                return res.redirect('/createDailySchedule');
            }

            let groupHalls = [];
            if (req.body.groupHallSelected && req.body.groupHallSelected.length > 0) {
                if (Array.isArray(req.body.groupHallSelected)) {
                    groupHalls = req.body.groupHallSelected;
                } else {
                    groupHalls = [req.body.groupHallSelected];
                }
            } else {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language));
                return res.redirect('/createDailySchedule');
            }
            let grpHalls = [];
            let hallsArray = [];
            let selectedHallsIds = [];

            for (let i = 0; i < groupHalls.length; i++) {
                if (req.body.halls && req.body.halls[groupHalls[i]].length > 0) {
                    console.log("halls and group of halls", req.body.halls[groupHalls[i]])
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id.toString());
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name, status: data.status, userTicketType: { Physical: 0, Terminal: 0, Web: 0 } } }),
                            selectedHalls: req.body.halls[groupHalls[i]].map(g => (grpHallsData.halls.find(h => h.id == g)))
                        }
                        grpHalls.push(grpArray);
                        selectedHallsIds.push(...req.body.halls[groupHalls[i]])
                    }
                }
            }


            let halls = await module.exports.findAvailableHallsBasedSlots(req.session.details, req.body.start_date, req.body.end_date, startTime, endTime);
            if (halls.status == "success") {
                let availableHalls = halls.groupHalls.allHalls;
                if (availableHalls.length > 0) {
                    availableHalls = availableHalls.map(a => a.id);
                    console.log("available ids array", availableHalls);
                    const hasAllIds = selectedHallsIds.every(elem => availableHalls.includes(elem));
                    console.log("hasAllIds---", hasAllIds);
                    if (hasAllIds == false) {
                        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                        return res.redirect('/gameManagement');
                    }
                }
            }

            let currentDate = Date.now()
            let dailyScheduleId = dateTimeFunction(currentDate);
            let masterHall = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.body.masterhall }, { name: 1 })
            let schedule = await Sys.App.Services.scheduleServices.insertDailySchedulesData({
                createrId: req.session.details.id,
                startDate: req.body.start_date,
                endDate: new Date(req.body.end_date).setHours(23, 59, 59, 999),
                days: req.body.schedule,
                groupHalls: grpHalls,
                allHallsId: hallsArray,
                masterHall: {
                    id: masterHall.id,
                    name: masterHall.name
                },
                dailyScheduleId: 'DSN_' + dailyScheduleId,
                halls: selectedHallsIds,
                startTime: startTime,
                endTime: endTime,
                'otherData.closeDay': [],
                'otherData.scheduleStartDate': new Date(moment(moment(req.body.start_date).format("YYYY-MM-DD") + " " + startTime).tz('UTC')),
                'otherData.scheduleEndDate': new Date(moment(moment(req.body.end_date).format("YYYY-MM-DD") + " " + endTime).tz('UTC')),
                'otherData.isAutoStopped': false
            });
            console.log("created daily scjedule", schedule)
            if (!schedule) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/gameManagement');
            } else {
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["schedule_create_successfully"], req.session.details.language));
                return res.redirect('/gameManagement');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    createDailySpecialSchedulePostData: async function (req, res) {
        try {
            console.log("createDailySpecialSchedulePostData: ", req.body);

            let timeSlot = req.body.timeSlot;
            let startTime = "";
            let endTime = "";
            if (timeSlot) {
                let times = timeSlot.split('-');
                startTime = times[0].trim();
                endTime = times[1].trim()
            }

            if (req.body.start_date == "" || req.body.masterhall == "") {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language));
                return res.redirect('/createDailySchedule');
            }

            let groupHalls = [];
            if (req.body.groupHallSelected && req.body.groupHallSelected.length > 0) {
                if (Array.isArray(req.body.groupHallSelected)) {
                    groupHalls = req.body.groupHallSelected;
                } else {
                    groupHalls = [req.body.groupHallSelected];
                }
            } else {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language));
                return res.redirect('/createDailySchedule');
            }
            let grpHalls = [];
            let hallsArray = [];
            let selectedHallsIds = [];

            for (let i = 0; i < groupHalls.length; i++) {
                if (req.body.halls && req.body.halls[groupHalls[i]].length > 0) {
                    console.log("halls and group of halls", req.body.halls[groupHalls[i]])
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id.toString());
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name, status: data.status, userTicketType: { Physical: 0, Terminal: 0, Web: 0 } } }),
                            selectedHalls: req.body.halls[groupHalls[i]].map(g => (grpHallsData.halls.find(h => h.id == g)))
                        }
                        grpHalls.push(grpArray);
                        selectedHallsIds.push(...req.body.halls[groupHalls[i]])
                    }
                }
            }


            let halls = await module.exports.findAvailableHallsSpecialBasedSlots(req.session.details, req.body.start_date, startTime, endTime);
            if (halls.status == "success") {
                let availableHalls = halls.groupHalls.allHalls;
                if (availableHalls.length > 0) {
                    availableHalls = availableHalls.map(a => a.id);
                    console.log("available ids array", availableHalls);
                    const hasAllIds = selectedHallsIds.every(elem => availableHalls.includes(elem));
                    console.log("hasAllIds---", hasAllIds);
                    if (hasAllIds == false) {
                        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                        return res.redirect('/gameManagement');
                    }
                }
            }


            let checkNormalGame = await module.exports.checkNormalGameInSameTime(req.session.details, req.body.halls, req.body.masterhall, req.body.start_date, startTime, endTime);

            if (checkNormalGame.status == 'fail') {
                req.flash('error', checkNormalGame.message);
                return res.redirect('/gameManagement');
            }

            const date = new Date(req.body.start_date);
            const dayAbbreviation = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
            const obj = { [dayAbbreviation]: [req.body.selectSchedule] };


            let currentDate = Date.now()
            let dailyScheduleId = dateTimeFunction(currentDate);
            let masterHall = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.body.masterhall }, { name: 1 })
            let schedule = await Sys.App.Services.scheduleServices.insertDailySchedulesData({
                createrId: req.session.details.id,
                startDate: req.body.start_date,
                endDate: new Date(req.body.start_date).setHours(23, 59, 59, 999),
                days: obj,
                groupHalls: grpHalls,
                allHallsId: hallsArray,
                masterHall: {
                    id: masterHall.id,
                    name: masterHall.name
                },
                dailyScheduleId: 'DSN_' + dailyScheduleId,
                halls: selectedHallsIds,
                startTime: startTime,
                endTime: endTime,
                specialGame: true,
                'otherData.closeDay': [],
                'otherData.scheduleStartDate': new Date(moment(moment(req.body.start_date).format("YYYY-MM-DD") + " " + startTime).tz('UTC')),
                'otherData.scheduleEndDate': new Date(moment(moment(req.body.start_date).format("YYYY-MM-DD") + " " + endTime).tz('UTC')),
            });
            console.log("created daily scjedule", schedule)
            if (!schedule) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/gameManagement');
            } else {
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["schedule_create_successfully"], req.session.details.language));
                return res.redirect('/gameManagement');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    checkNormalGameInSameTime: async function (user, halls, masterHall, startDate, startTime, endTime) {
        try {
            console.log("detail, startDate, startTime, endTime", halls, masterHall, startDate, startTime, endTime);

            let start_Date = new Date(startDate);
            let end_Date = new Date(startDate).setHours(23, 59, 59, 999);

            let dataQuery = {
                "status": { "$in": ['running', 'active'] },
                "stopGame": false,
                "startDate": { "$gte": start_Date, "$lt": end_Date },
                "isSavedGame": false
            }

            if (user.role == 'agent') {
                dataQuery['allHallsId'] = user.hall[0].id;
            }

            console.log("Query for date search", dataQuery);

            // Fetch schedules data
            let SchedulesData = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {
                _id: 1, groupHalls: 1, startTime: 1, endTime: 1, masterHall: 1, halls: 1, allHallsId: 1
            });

            // Extract hall IDs once
            let hallIds = Object.values(halls).flat();

            // Filter schedules based on hall IDs
            let filterSchedule = SchedulesData.filter(e => hallIds.some(item => e.halls.includes(item)));

            // Convert the start and end times for comparison
            const checkStartTime = parseTime(startTime);
            const checkEndTime = parseTime(endTime);

            // Process overlapping games
            await Promise.all(filterSchedule.map(async game => {
                console.log("game", game);

                const gameStartTime = parseTime(game.startTime);
                const gameEndTime = parseTime(game.endTime);

                // Check for time overlaps
                if (!(checkStartTime < gameEndTime && checkEndTime > gameStartTime)) return;

                const commonElements = hallIds.filter(item => game.halls.includes(item));
                const difference = game.halls.filter(item => !commonElements.includes(item));
                console.log("differenceK", difference);

                if (difference.length) {
                    let queryscheduleGameData = { parentGameId: game._id, status: "active" };
                    let scheduleGameData = await Sys.App.Services.GameService.getByData(queryscheduleGameData)

                    for (let i = 0; i < scheduleGameData.length; i++) {
                        const element = scheduleGameData[i];

                        let masterHallId = element.otherData.masterHallId

                        // Update selected halls
                        let groupHallData = JSON.stringify(element.groupHalls)
                        console.log("groupHallData", groupHallData);

                        let updatedGroupHalls = element.groupHalls.filter(ghall => {
                            ghall.selectedHalls = ghall.selectedHalls.filter(e => !commonElements.includes(e.id));
                            console.log("ghall.selectedHalls.length", ghall.selectedHalls.length);
                            return ghall.selectedHalls.length > 0;
                        });
                        console.log("updatedGroupHalls", updatedGroupHalls);
                        const allHallIds = updatedGroupHalls.flatMap(group => group.halls.map(hall => hall.id));
                        const selectHallId = updatedGroupHalls.flatMap(group => group.selectedHalls.map(hall => hall.id));

                        let updateObj = {
                            halls: selectHallId,
                            groupHalls: updatedGroupHalls,
                            allHallsId: allHallIds,
                            removeForSpecailGame: {
                                halls: element.halls,
                                groupHalls: JSON.parse(groupHallData),
                                allHallsId: element.allHallsId,
                            },
                            isChangeforSpecailGame: true
                        }



                        if (hallIds.includes(masterHallId)) {
                            updateObj['otherData.masterHallId'] = updatedGroupHalls[0].selectedHalls[0].id
                        }

                        console.log("updateObj", updateObj.removeForSpecailGame.groupHalls);

                        let query = { _id: element._id, status: "active" };
                        console.log("query", query);
                        let xyz = await Sys.App.Services.GameService.updateGameData(
                            query,
                            {
                                $set: updateObj
                            }
                        );

                        console.log("xyz", xyz);



                    }

                } else {
                    let startDate = new Date()
                    startDate.setHours(0, 0, 0, 0);
                    let endDate = new Date();
                    endDate.setHours(23, 59, 59, 999);

                    let queryscheduleGameData = {
                        parentGameId: game._id,
                        status: "active",
                        startDate: {
                            $gte: startDate,
                            $lt: endDate
                        }
                    };
                    let scheduleGameData = await Sys.App.Services.GameService.getByData(queryscheduleGameData)
                    console.log("scheduleGameData", scheduleGameData);
                    for (let i = 0; i < scheduleGameData.length; i++) {
                        const element = scheduleGameData[i];
                        await Sys.App.Services.GameService.updateGameData(
                            { _id: element._id, status: "active" },
                            {
                                "$set": {
                                    "stopGame": true,
                                    isChangeforSpecailGame: true,
                                    halls: [],
                                    groupHalls: [],
                                    allHallsId: [],
                                    removeForSpecailGame: {
                                        halls: element.halls,
                                        groupHalls: element.groupHalls,
                                        allHallsId: element.allHallsId,
                                    },
                                }
                            }
                        );
                    }

                    module.exports.refundStoppedSchedule({ dailyScheudleId: game._id });

                }
            }));

            return {
                "status": "success",
                "message": "Success",
                "groupHalls": {}
            };


        } catch (error) {
            console.log("checkNormalGameInSameTime Error", error);
            return {
                "status": "fail",
                "message": "Something went wrong",
                "groupHalls": {}
            };
        }
    },

    getMasterHallData: async function (req, res) {
        try {
            console.log("req", req.body);
            let timeSlot = req.body.timeSlot;
            let startTime = "";
            let endTime = "";
            if (timeSlot) {
                let times = timeSlot.split('-');
                startTime = times[0].trim();
                endTime = times[1].trim()
            }

            if (req.body.startDate == "" || req.body.masterhall == "") {
                return res.send({
                    status: 'fail',
                    message: await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language)
                });
            }

            let startDate = new Date(req.body.startDate);
            let endDate = new Date(req.body.startDate).setHours(23, 59, 59, 999);

            let dataQuery = {
                "status": { "$in": ['running', 'active'] },
                "stopGame": false,
                "$or": [
                    { startDate: { $gte: startDate, $lte: endDate } },
                    { endDate: { $gte: startDate, $lte: endDate } }
                ],
                "masterHall.id": req.body.masterHall
            }

            console.log("dataQuery", dataQuery);

            let data = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {});

            let latestData = [];
            if (data.length > 0) {    //9 to 12   10 to 13  7 to 8:30
                for (let i = 0; i < data.length; i++) {
                    let dataStart = data[i].startTime;
                    let dataEnd = data[i].endTime;

                    if (
                        (startTime >= dataStart && startTime <= dataEnd) ||  // start time falls within data range
                        (endTime >= dataStart && endTime <= dataEnd) ||      // end time falls within data range
                        (startTime <= dataStart && endTime >= dataEnd)       // entire data range falls within timeSlot
                    ) {
                        latestData.push(data[i]);
                    }
                }
            }
            console.log("latestData--", latestData)
            data = latestData;

            console.log("halls", data);
            return res.send({
                "status": "success",
                "message": await Sys.Helper.bingo.getSingleTraslateData(["master_data"], req.session.details.language),
                data: data
            });

        } catch (error) {
            console.log("error getMasterHallData", error);
            return res.send({
                "status": "fail",
                "message": await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language),
            });
        }

    },

    editDailyScheduleOld: async function (req, res) {
        try {
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.params.id }, {}, {});

            let subgamesList = await Sys.App.Services.scheduleServices.getSchedulesByData({}, { scheduleName: 1 }, {});
            let days = [];
            let selectedSubGames = [];
            if (Object.keys(schedule.days).length) {
                days = Object.keys(schedule.days);
                for (const day in schedule.days) {
                    selectedSubGames.push({ day: day, selectedSchedule: schedule.days[day][0] });
                }
            }

            let groupOfHallsIds = [];
            let groupOfHalls = [];
            let availableForSelectionMasterHals = [];
            let allHalls = [];
            if (schedule.groupHalls.length > 0) {
                for (let g = 0; g < schedule.groupHalls.length; g++) {
                    groupOfHallsIds.push(schedule.groupHalls[g].id);
                    groupOfHalls.push(schedule.groupHalls[g]);
                    if (schedule.groupHalls[g].selectedHalls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].selectedHalls.length; h++) {
                            availableForSelectionMasterHals.push(schedule.groupHalls[g].selectedHalls[h]);
                        }
                    }

                    if (schedule.groupHalls[g].halls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].halls.length; h++) {
                            allHalls.push(schedule.groupHalls[g].halls[h]);
                        }
                    }
                }
            }

            // start find other available group of halls
            if (schedule.startDate !== '' && schedule.endDate !== '') {
                startDate = new Date(schedule.startDate);
                endDate = new Date(schedule.endDate);
                let dataQuery = {
                    "status": { "$in": ['running', 'active'] },
                    "stopGame": false,
                    "$or": [
                        { startDate: { $gte: startDate, $lte: endDate } },
                        { endDate: { $gte: startDate, $lte: endDate } }
                    ]
                }

                let data = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {
                    _id: 0,
                    groupHalls: 1
                });

                if (data.length) {
                    let uniqueId = [];
                    for (let i = 0; i < data.length; i++) {
                        const element = data[i].groupHalls;
                        for (let j = 0; j < element.length; j++) {
                            uniqueId.push(element[j].id);
                        }
                    }
                    data = uniqueId.filter((v, i, a) => a.indexOf(v) === i);
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ _id: { "$nin": data }, status: "active" }, { name: 1, halls: 1 });
                    console.log("groupHallsAvailable", groupHallsAvailable);
                } else {
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ "status": "active" }, { name: 1, halls: 1 });
                }
            }
            console.log("groupHallsAvailable", groupHallsAvailable)
            let allHallsNew = [];
            if (groupHallsAvailable.length > 0) {
                for (let i = 0; i < groupHallsAvailable.length; i++) {
                    if (groupHallsAvailable[i].halls.length > 0) {
                        let groupHalls = []
                        for (let j = 0; j < groupHallsAvailable[i].halls.length; j++) {
                            if (groupHallsAvailable[i].halls[j].status == "active") {
                                groupHalls.push(groupHallsAvailable[i].halls[j])
                                allHallsNew.push(groupHallsAvailable[i].halls[j])
                            }
                        }
                        groupHallsAvailable[i].halls = groupHalls;

                        if (groupHallsAvailable[i].halls.length > 0) {
                            for (let h = 0; h < groupHallsAvailable[i].halls.length; h++) {
                                allHalls.push(groupHallsAvailable[i].halls[h]);
                            }
                        }

                    }
                }

                for (let i = 0; i < groupHallsAvailable.length; i++) {
                    groupOfHalls.push({
                        id: groupHallsAvailable[i]._id,
                        name: groupHallsAvailable[i].name,
                        halls: groupHallsAvailable[i].halls,
                        isnotSelected: true,
                    })
                }

            }
            // end

            /*if(groupOfHallsIds.length > 0){
                updatedghalls = await Sys.App.Services.GroupHallServices.getByData({ _id: { $in: groupOfHallsIds } }, { name: 1, halls: 1 });
                console.log("updatedghalls", updatedghalls)

                if(updatedghalls.length > 0){
                    for(let i=0; i < updatedghalls.length; i++){
                        if(updatedghalls[i].halls.length > 0){
                            let groupHalls = []
                            for(let j=0; j < updatedghalls[i].halls.length; j++){
                                if(updatedghalls[i].halls[j].status == "active"){
                                    groupHalls.push(updatedghalls[i].halls[j])
                                }
                            }
                            //updatedghalls[i].halls = groupHalls;

                            let index = groupOfHalls.findIndex(x => x.id == updatedghalls[i].id);
                            if(index >= 0){
                                groupOfHalls[index].halls = groupHalls;
                            }
                        }
                        
                    }
                }
            }*/
            console.log("availableForSelectionMasterHals", groupOfHalls);
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                subGameList: subgamesList,
                scheduleId: schedule._id,
                groupHallArray: groupOfHalls,
                groupOfHallsIds: groupOfHallsIds,
                startDate: moment(new Date(schedule.startDate)).tz('UTC').format('YYYY-MM-DD'),
                endDate: moment(new Date(schedule.endDate)).tz('UTC').format('YYYY-MM-DD'),
                days: days,
                selectedSubGames: selectedSubGames,
                availableForSelectionMasterHals: availableForSelectionMasterHals,
                masterHall: schedule.masterHall,
                allHalls: allHalls,
                slug: 'Edit',
            };
            return res.render('dailySchedules/create', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editDailySchedule: async function (req, res) {
        try {
            let keys = [
                "daily_schedule_management",
                "dashboard",
                "edit_daily_schedule",
                "save_game",
                "save_as",
                "enter_name_of_daily_schedule",
                "please",
                "save",
                "start_date",
                "end_date",
                "select_time_slot",
                "select_weekdays",
                "select_schedule_for_each_weeday",
                "select_schedule",
                "select_group_of_halls",
                "select_halls",
                "select_master_hall",
                "submit",
                "cancel",
                "created",
                "error",
                "daily_schedule_aved_success",
                "minimum_1_day_gap"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.params.id }, {}, {});
            if (schedule && (schedule.status == "running" || schedule.stopGame == true)) {
                req.flash('error', 'Something went wrong, please try again');
                return res.redirect('/gameManagement');
            }
            let subgamesList = await Sys.App.Services.scheduleServices.getSchedulesByData({}, { scheduleName: 1, manualStartTime: 1, manualEndTime: 1 }, {});

            let allTimeSlots = [];
            if (subgamesList.length > 0) {
                for (let s = 0; s < subgamesList.length; s++) {
                    let isSelected = false;
                    if (subgamesList[s].manualStartTime != "" && subgamesList[s].manualEndTime != "") {
                        if (subgamesList[s].manualStartTime == schedule.startTime && subgamesList[s].manualEndTime == schedule.endTime) {
                            isSelected = true;
                        }
                        allTimeSlots.push({ startTime: subgamesList[s].manualStartTime, endTime: subgamesList[s].manualEndTime, isSelected: isSelected });
                    }
                }
            }
            let uniqueTimeSlots = allTimeSlots.filter((v, i, a) => a.findIndex(v2 => ['startTime', 'endTime'].every(k => v2[k] === v[k])) === i);
            let sortedTimeSlots = uniqueTimeSlots.sort((a, b) => a.startTime > b.startTime ? 1 : -1);

            let schedulesBasedSlot = await Sys.App.Services.scheduleServices.getSchedulesByData({ manualStartTime: schedule.startTime, manualEndTime: schedule.endTime }, { scheduleName: 1 }, {});

            let days = [];
            let selectedSubGames = [];
            if (Object.keys(schedule.days).length) {
                days = Object.keys(schedule.days);
                for (const day in schedule.days) {
                    selectedSubGames.push({ day: day, selectedSchedule: schedule.days[day][0] });
                }
            }

            let groupOfHallsIds = [];
            let groupOfHalls = [];
            let availableForSelectionMasterHals = [];
            let allHalls = [];
            // if(schedule.groupHalls.length > 0){
            //     for(let g=0; g < schedule.groupHalls.length; g++){
            //         groupOfHallsIds.push(schedule.groupHalls[g].id);
            //         groupOfHalls.push(schedule.groupHalls[g]);
            //         if(schedule.groupHalls[g].selectedHalls.length > 0){
            //             for(let h=0; h < schedule.groupHalls[g].selectedHalls.length; h++){
            //                 availableForSelectionMasterHals.push(schedule.groupHalls[g].selectedHalls[h]);
            //             }
            //         }

            //         if(schedule.groupHalls[g].halls.length > 0){
            //             for(let h=0; h < schedule.groupHalls[g].halls.length; h++){
            //                 allHalls.push(schedule.groupHalls[g].halls[h]);
            //             }
            //         }
            //     }
            // }

            // // start find other available group of halls
            // let availableGroups = [];
            // if (schedule.startDate !== '' && schedule.endDate !== '') {
            //     startDate = new Date(schedule.startDate);
            //     endDate = new Date(schedule.endDate);
            //     if (startDate !== '' && endDate !== '') {
            //         let halls = await module.exports.findAvailableHalls(startDate, endDate);
            //         if(halls.status == "success"){
            //             availableGroups = halls.groupHalls.groupHallsAvailable
            //         }
            //     }
            // }
            // console.log("groupHallsAvailable", availableGroups)
            // if(availableGroups.length > 0){
            //     for(let i=0; i < availableGroups.length; i++){
            //         let index = groupOfHalls.findIndex(x => x.id == availableGroups[i]._id.toString());
            //         //console.log("index ", index, availableGroups[i]._id.toString())
            //         if(index >= 0){
            //             console.log("groupOfHalls[index]", groupOfHalls[index].name, availableGroups[i].halls)
            //             groupOfHalls[index].halls = availableGroups[i].halls
            //             console.log("after replacing halls", groupOfHalls[index].name, groupOfHalls[index].halls, ...groupOfHalls[index].selectedHalls)
            //             groupOfHalls[index].halls.push(...groupOfHalls[index].selectedHalls);
            //             console.log("after replacing halls second", groupOfHalls[index].name, groupOfHalls[index].halls)
            //             //allHalls.push(...availableGroups[i].halls)

            //         }else{
            //             groupOfHalls.push({
            //                 id: availableGroups[i]._id.toString(),
            //                 name: availableGroups[i].name,
            //                 halls: availableGroups[i].halls,
            //                 isnotSelected: true, 
            //             });
            //             groupOfHallsIds.push(availableGroups[i]._id.toString());

            //             allHalls.push(...availableGroups[i].halls);

            //         }
            //     }
            // }else{
            //     allHalls = [];
            //     if(groupOfHalls.length > 0){
            //         for(let g=0; g < groupOfHalls.length; g++){
            //             groupOfHalls[g].halls = groupOfHalls[g].selectedHalls;
            //             allHalls.push(...groupOfHalls[g].selectedHalls)
            //         }
            //     }
            // }

            let availHalls = await module.exports.findAvailableHallForEditBasedSlot(req.params.id, req.session.details)
            console.log("availHalls", availHalls)
            if (availHalls.status == "success") {
                groupOfHallsIds = availHalls.groupHalls.groupOfHallsIds;
                groupOfHalls = availHalls.groupHalls.groupOfHalls;
                availableForSelectionMasterHals = availHalls.groupHalls.availableForSelectionMasterHals;
                allHalls = availHalls.groupHalls.allHalls;
            }
            console.log("availableForSelectionMasterHals", groupOfHalls, groupOfHallsIds, availableForSelectionMasterHals, allHalls);
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                subGameList: schedulesBasedSlot, //subgamesList,
                scheduleId: schedule._id,
                groupHallArray: groupOfHalls,
                groupOfHallsIds: groupOfHallsIds,
                startDate: moment(new Date(schedule.startDate)).tz('UTC').format('YYYY-MM-DD'),
                endDate: moment(new Date(schedule.endDate)).tz('UTC').format('YYYY-MM-DD'),
                days: days,
                selectedSubGames: selectedSubGames,
                availableForSelectionMasterHals: availableForSelectionMasterHals,
                masterHall: schedule.masterHall.id,
                allHalls: allHalls,
                slug: 'Edit',
                timeSlots: sortedTimeSlots,
                translate,
                navigation: translate
            };
            return res.render('dailySchedules/create', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    findAvailableHallForEdit: async function (scheduleId) {
        try {
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: scheduleId }, {}, {});

            let groupOfHallsIds = [];
            let groupOfHalls = [];
            let availableForSelectionMasterHals = [];
            let allHalls = [];
            if (schedule.groupHalls.length > 0) {
                for (let g = 0; g < schedule.groupHalls.length; g++) {
                    groupOfHallsIds.push(schedule.groupHalls[g].id);
                    groupOfHalls.push(schedule.groupHalls[g]);
                    if (schedule.groupHalls[g].selectedHalls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].selectedHalls.length; h++) {
                            availableForSelectionMasterHals.push(schedule.groupHalls[g].selectedHalls[h]);
                        }
                    }

                    if (schedule.groupHalls[g].halls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].halls.length; h++) {
                            allHalls.push(schedule.groupHalls[g].halls[h]);
                        }
                    }
                }
            }

            if (groupOfHalls.length > 0) {
                for (let h = 0; h < groupOfHalls.length; h++) {
                    let activeHalls = [];
                    for (let j = 0; j < groupOfHalls[h].halls.length; j++) {
                        if (groupOfHalls[h].halls[j].status == "active") {
                            activeHalls.push(groupOfHalls[h].halls[j])
                        }
                    }
                    groupOfHalls[h].halls = activeHalls;
                }
            }

            // start find other available group of halls
            let availableGroups = [];
            if (schedule.startDate !== '' && schedule.endDate !== '') {
                startDate = new Date(schedule.startDate);
                endDate = new Date(schedule.endDate);
                if (startDate !== '' && endDate !== '') {
                    let halls = await module.exports.findAvailableHalls(req.session.details, startDate, endDate);
                    //console.log("halls", halls)
                    if (halls.status == "success") {
                        availableGroups = halls.groupHalls.groupHallsAvailable
                    }
                }
            }
            //console.log("groupHallsAvailable", availableGroups, groupOfHalls)
            if (availableGroups.length > 0) {

                if (groupOfHalls.length > 0) {
                    for (let h = 0; h < groupOfHalls.length; h++) {
                        let index = availableGroups.findIndex(x => x._id == groupOfHalls[h].id);
                        if (index < 0) {
                            //console.log("not found hall, means fulled halls", groupOfHalls[h])
                            // this group's all halls are full,  so only consider already selected halls
                            groupOfHalls[h].halls = groupOfHalls[h].selectedHalls;
                        }
                    }
                }


                for (let i = 0; i < availableGroups.length; i++) {
                    let index = groupOfHalls.findIndex(x => x.id == availableGroups[i]._id.toString());
                    //console.log("index ", index, availableGroups[i]._id.toString())
                    if (index >= 0) {
                        console.log("groupOfHalls[index]", groupOfHalls[index].name, availableGroups[i].halls)
                        groupOfHalls[index].halls = availableGroups[i].halls
                        console.log("after replacing halls", groupOfHalls[index].name, groupOfHalls[index].halls, ...groupOfHalls[index].selectedHalls)
                        groupOfHalls[index].halls.push(...groupOfHalls[index].selectedHalls);
                        console.log("after replacing halls second", groupOfHalls[index].name, groupOfHalls[index].halls)
                        //allHalls.push(...availableGroups[i].halls)

                    } else {
                        //console.log("fresh halls, which are not used", availableGroups[i])
                        groupOfHalls.push({
                            id: availableGroups[i]._id.toString(),
                            name: availableGroups[i].name,
                            halls: availableGroups[i].halls,
                            isnotSelected: true,
                        });
                        groupOfHallsIds.push(availableGroups[i]._id.toString());

                        allHalls.push(...availableGroups[i].halls);

                    }
                }
            } else {
                allHalls = [];
                if (groupOfHalls.length > 0) {
                    for (let g = 0; g < groupOfHalls.length; g++) {
                        groupOfHalls[g].halls = groupOfHalls[g].selectedHalls;
                        allHalls.push(...groupOfHalls[g].selectedHalls)
                    }
                }
            }

            return {
                "status": "success",
                "groupHalls": { groupOfHallsIds: groupOfHallsIds, groupOfHalls: groupOfHalls, availableForSelectionMasterHals: availableForSelectionMasterHals, allHalls: allHalls }
            };
        } catch (e) {
            return {
                "status": "error",
                "findAvailableHallForEdit": {}
            };
        }
    },

    editDailySchedulePostData: async function (req, res) {
        try {
            console.log("editDailySchedulePostData: ", req.body);

            if (req.body.start_date == "" || req.body.end_date == "" || req.body.schedule.length <= 0 || req.body.masterhall == "") {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language));
                return res.redirect('/editDailySchedule/' + req.params.id);
            }

            let groupHalls = [];
            if (req.body.groupHallSelected && req.body.groupHallSelected.length > 0) {
                if (Array.isArray(req.body.groupHallSelected)) {
                    groupHalls = req.body.groupHallSelected;
                } else {
                    groupHalls = [req.body.groupHallSelected];
                }
            } else {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language));
                return res.redirect('/editDailySchedule/' + req.params.id);
            }
            let grpHalls = [];
            let hallsArray = [];
            let selectedHallsIds = [];
            for (let i = 0; i < groupHalls.length; i++) {
                if (req.body.halls && req.body.halls[groupHalls[i]].length > 0) {
                    console.log("halls and group of halls", req.body.halls[groupHalls[i]])
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id.toString());
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name, status: data.status } }),
                            selectedHalls: req.body.halls[groupHalls[i]].map(g => (grpHallsData.halls.find(h => h.id == g)))
                        }
                        grpHalls.push(grpArray);
                        selectedHallsIds.push(...req.body.halls[groupHalls[i]])
                    }
                }
            }
            let currentDate = Date.now()
            let dailyScheduleId = dateTimeFunction(currentDate);
            let masterHall = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.body.masterhall }, { name: 1 })
            let schedule = await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: req.params.id }, {
                startDate: req.body.start_date,
                endDate: new Date(req.body.end_date).setHours(23, 59, 59, 999),
                days: req.body.schedule,
                groupHalls: grpHalls,
                allHallsId: hallsArray,
                masterHall: {
                    id: masterHall.id,
                    name: masterHall.name
                },
                halls: selectedHallsIds
            });

            console.log("created daily schedule", schedule)
            if (!schedule) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/editDailySchedule/' + req.params.id);
            } else {
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/gameManagement');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    viewDailySchedule: async function (req, res) {
        try {

            let keys = [
                "dashboard",
                "view_saved_daily_schedule",
                "special_schedule_management",
                "daily_schedule_management",
                "view_daily_schedule",
                "start_date",
                "end_date",
                "select_time_slot",
                "selected_weekdays",
                "select_schedule_for_each_weeday",
                "select_schedule",
                "grop_of_halls",
                "grop_of_halls_name",
                "master_hall",
                "cancel",
                "view",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.params.id }, {}, {});

            let subgamesList = await Sys.App.Services.scheduleServices.getSchedulesByData({}, { scheduleName: 1, manualStartTime: 1, manualEndTime: 1 }, {});

            let allTimeSlots = [];
            if (subgamesList.length > 0) {
                for (let s = 0; s < subgamesList.length; s++) {
                    let isSelected = false;
                    if (subgamesList[s].manualStartTime != "" && subgamesList[s].manualEndTime != "") {
                        if (subgamesList[s].manualStartTime == schedule.startTime && subgamesList[s].manualEndTime == schedule.endTime) {
                            isSelected = true;
                        }
                        allTimeSlots.push({ startTime: subgamesList[s].manualStartTime, endTime: subgamesList[s].manualEndTime, isSelected: isSelected });
                    }
                }
            }
            let uniqueTimeSlots = allTimeSlots.filter((v, i, a) => a.findIndex(v2 => ['startTime', 'endTime'].every(k => v2[k] === v[k])) === i);
            let sortedTimeSlots = uniqueTimeSlots.sort((a, b) => a.startTime > b.startTime ? 1 : -1);

            let schedulesBasedSlot = await Sys.App.Services.scheduleServices.getSchedulesByData({ manualStartTime: schedule.startTime, manualEndTime: schedule.endTime }, { scheduleName: 1 }, {});


            let days = [];
            let selectedSubGames = [];
            if (Object.keys(schedule.days).length) {
                days = Object.keys(schedule.days);
                for (const day in schedule.days) {
                    selectedSubGames.push({ day: day, selectedSchedule: schedule.days[day][0] });
                }
            }

            let groupOfHallsIds = [];
            let groupOfHalls = [];
            let availableForSelectionMasterHals = [];
            let allHalls = [];
            if (schedule.groupHalls.length > 0) {
                for (let g = 0; g < schedule.groupHalls.length; g++) {
                    groupOfHallsIds.push(schedule.groupHalls[g].id);
                    groupOfHalls.push(schedule.groupHalls[g]);
                    if (schedule.groupHalls[g].selectedHalls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].selectedHalls.length; h++) {
                            availableForSelectionMasterHals.push(schedule.groupHalls[g].selectedHalls[h]);
                        }
                    }

                    if (schedule.groupHalls[g].halls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].halls.length; h++) {
                            allHalls.push(schedule.groupHalls[g].halls[h]);
                        }
                    }
                }
            }

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                subGameList: schedulesBasedSlot, //subgamesList,
                scheduleId: schedule._id,
                groupHallArray: groupOfHalls,
                groupOfHallsIds: groupOfHallsIds,
                startDate: moment(new Date(schedule.startDate)).tz('UTC').format('YYYY-MM-DD'),
                endDate: moment(new Date(schedule.endDate)).tz('UTC').format('YYYY-MM-DD'),
                days: days,
                selectedSubGames: selectedSubGames,
                availableForSelectionMasterHals: availableForSelectionMasterHals,
                masterHall: schedule.masterHall.id,
                allHalls: allHalls,
                slug: 'View',
                timeSlots: sortedTimeSlots,
                specialGame: schedule.specialGame,
                translate: translate,
                navigation: translate
            };
            return res.render('dailySchedules/view', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteDailySchedule: async function (req, res) {
        try {
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.body.id });
            if (schedule || schedule.length > 0) {
                await Sys.App.Services.scheduleServices.deleteDailySchedule({ _id: req.body.id });
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    saveDailySchedulePostData: async function (req, res) {
        try {
            console.log("saveDailySchedulePostData: ", req.body);

            let timeSlot = req.body.timeSlot;
            let startTime = "";
            let endTime = "";
            if (timeSlot) {
                let times = timeSlot.split('-');
                startTime = times[0].trim();
                endTime = times[1].trim()
            }

            if (req.body.start_date == "" || req.body.end_date == "" || req.body.schedule.length <= 0 || req.body.masterhall == "" || req.body.saveGameName == "") {
                return res.send({ status: 'fail', message: await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language) });
            }

            let groupHalls = [];
            if (req.body.groupHallSelected && req.body.groupHallSelected.length > 0) {
                if (Array.isArray(req.body.groupHallSelected)) {
                    groupHalls = req.body.groupHallSelected;
                } else {
                    groupHalls = [req.body.groupHallSelected];
                }
            } else {
                return res.send({ status: 'fail', message: await Sys.Helper.bingo.getSingleTraslateData(["pls_fill_all_form_field"], req.session.details.language) });
            }
            let grpHalls = [];
            let hallsArray = [];

            for (let i = 0; i < groupHalls.length; i++) {
                if (req.body.halls && req.body.halls[groupHalls[i]].length > 0) {
                    console.log("halls and group of halls", req.body.halls[groupHalls[i]])
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id.toString());
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name } }),
                            selectedHalls: req.body.halls[groupHalls[i]].map(g => (grpHallsData.halls.find(h => h.id == g)))
                        }
                        grpHalls.push(grpArray);
                    }
                }
            }
            let currentDate = Date.now()
            let dailyScheduleId = dateTimeFunction(currentDate);
            let masterHall = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.body.masterhall }, { name: 1 })
            let schedule = await Sys.App.Services.scheduleServices.insertDailySchedulesData({
                createrId: req.session.details.id,
                isAdminSavedGame: (req.session.details.role == 'admin') ? true : false,
                startDate: req.body.start_date,
                endDate: req.body.end_date,
                days: req.body.schedule,
                groupHalls: grpHalls,
                allHallsId: hallsArray,
                //masterHall: req.body.masterhall,
                masterHall: {
                    id: masterHall.id,
                    name: masterHall.name
                },
                dailyScheduleId: 'SG_' + dailyScheduleId,
                name: req.body.savedGameName,
                isSavedGame: true,
                startTime: startTime,
                endTime: endTime
            });
            console.log("created daily scjedule", schedule)
            if (!schedule) {
                return res.send({ status: 'fail', message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language) });
            } else {
                return res.send({ status: 'success' });
            }

        } catch (e) {
            console.log("Error", e);
            return res.send({ status: 'fail', message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language) });
        }
    },

    viewDailySchduleDetails: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let startFlag = true;
            console.log("session details of req sender", req.session.details);
            if(!req.session.details.isSuperAdmin){
                let stringReplace = req.session.details.isPermission['Games Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("edit") == -1) {
                    editFlag = false;
                }
                if (stringReplace?.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
                if (stringReplace?.indexOf("start") == -1) {
                    startFlag = false;
                }
            }
            let keys = [
                "ongoing_schedule",
                "dashboard",
                "no_schedule_for_today",
                "schedules_name",
                "schedules_type",
                "date",
                "sub_game_details",
                "sub_game_id",
                "sub_game_name",
                "start_time",
                "ticket_color_type",
                "ticket_price",
                "total_no_ticket_sold",
                "total_earned_from",
                "tickets_sold",
                "replace_ticket",
                "total_winning_game",
                "profit",
                "profit_percentage",
                "status",
                "action",
                "scheduled_game",
                "game_id",
                "start_date",
                "day",
                "start_time_end_time",
                "agent_info",
                "ready_to_go",
                "not_ready_yet",
                "attention",
                "some_agent_not_ready_are_you_sure",
                "start",
                "cancel",
                "confirm_jackpot_draw",
                "jackpot_prize_and_draw",
                "jackpot_prize_and_draws",
                "jackpot_yellow_prize",
                "jackpot_white_prize",
                "jackpot_purple_prize",
                "draw",
                "confirm",
                "remaining_time",
                "minutes",
                "ok",
                "something_went_wrong",
                "confirm_jackpot_draw_to_start_game",
                "jackpot_draw",
                "active",
                "upcoming",
                "stopped",
                "all",
                "no_data_available_in_table",
                "view_game",
                "edit_game",
                "start",
                "live",
                "info",
                "are_you_sure",
                "yes",
                "no",
                "done",
                "fail",
                "status_updated",
                "status_not_updated",
                "status_update_cancel",
                "are_you_sure_you_want_to_start_game",
                "alert",
                "some_agent_not_yet_ready",
                "search",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let dailySchedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.params.id }, {}, {});
            // console.log("dailySchedule====", dailySchedule)
            let startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            let endofDay = new Date();
            endofDay.setHours(23, 59, 59, 999);
            let todaysGame = await Sys.App.Services.GameService.getSingleGameData({
                parentGameId: req.params.id,
                startDate: {
                    $gte: startOfDay,
                    $lte: endofDay
                }
            }, { gameMode: 1, otherData: 1, startDate: 1 });
            console.log("todaysGame", todaysGame);

            let subGames = [];
            if (dailySchedule) {
                let selectedSchedules = [...new Set(Object.values(dailySchedule.days).flat(1))];
                // console.log("selectedSchedules", selectedSchedules);
                let data = await Sys.App.Services.scheduleServices.getSchedulesByData({ _id: { $in: selectedSchedules } }, { subGames: 1, scheduleType: 1, scheduleName: 1, manualStartTime: 1, manualEndTime: 1 }, {});
                // console.log("data", data)
                if (data.length > 0) {
                    for (let i = 0; i < data.length; i++) {
                        let endDate = data[i].manualEndTime;
                        let startDate = [];
                        if (data[i].scheduleType == "Auto") {
                            endDate = data[i].subGames[data[i].subGames.length - 1].end_time;
                        }
                        if (data[i].subGames.length > 0) {
                            for (let j = 0; j < data[i].subGames.length; j++) {
                                if (data[i].scheduleType == "Auto") {
                                    startDate.push(data[i].subGames[j].start_time);
                                } else {
                                    startDate.push(data[i].manualStartTime);
                                }
                            }
                        }

                        subGames.push({
                            id: data[i]._id,
                            name: data[i].scheduleName,
                            type: data[i].scheduleType,
                            startDate: startDate,
                            endDate: endDate,
                        });
                    }
                }
            }
            // console.log("subGames", subGames)

            let isMaster = true;
            if (req.session.details.role == "agent" && req.session.details.hall[0].id !== dailySchedule.masterHall.id) {
                isMaster = false;
            }

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                todaysGame: todaysGame,
                ScheduleDate: (todaysGame && todaysGame.startDate) ? moment(todaysGame.startDate).format("YYYY-MM-DD") : "",
                schedule: dailySchedule,
                subGames: subGames,
                isMaster: isMaster,
                //isJackpotPrizeRequired: true,
                slug: 'view',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                startFlag: startFlag,
                translate: translate,
                navigation: translate
            };
            return res.render('dailySchedules/scheduleGame', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getCurrentSubgames: async function (req, res) {
        try {
            let order = req.query.order;
            let sort = { createdAt: 1 };

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            //let search = req.query.search.value;

            let startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            let endofDay = new Date();
            endofDay.setHours(23, 59, 59, 999);
            let query = {
                parentGameId: req.params.id,
                startDate: {
                    $gte: startOfDay,
                    $lte: endofDay
                }
            };

            // console.log("req.query.type-", req.query.type)
            // if (req.query.type && (req.query.type == "Auto" || req.query.type == "Manual") ) {
            //     query.scheduleType = req.query.type;
            // }
            if (req.query.gameStatus && (req.query.gameStatus == "active" || req.query.gameStatus == "upcoming")) {
                query.status = (req.query.gameStatus == "active") ? "running" : "active";
                query.stopGame = false;
            } else if (req.query.gameStatus && req.query.gameStatus == "stopped") {
                query.stopGame = true;
            }
            let reqCount = await Sys.App.Services.GameService.getGameCount(query);

            let data = await Sys.App.Services.GameService.getGamesByData(query, {}, { sort: sort }); //{ sort: sort, limit: length, skip: start }
            if (data.length && !data[0].groupHalls.length) {
                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': 0,
                    'recordsFiltered': 0,
                    'data': [],
                };

                return res.send(obj);
            }
            let gameData = [];
            // let dailySchedule 
            // if (data.length) {
            //     dailySchedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: data[0].parentGameId }, {}, {});
            // }
            for (let i = 0; i < data.length; i++) {
                let ticket = [];
                if (data[i].subGames[0].options.length > 0) {
                    for (let j = 0; j < data[i].subGames[0].options.length; j++) {
                        ticket.push({
                            color: data[i].subGames[0].options[j].ticketName,
                            price: data[i].subGames[0].options[j].ticketPrice
                        })
                    }
                }

                let isReady = true;

                if (req.session.details.role == "agent") {
                    let agent = data[i].otherData.agents.find(agent => { return agent.id.equals(req.session.details.id) && agent.hallId.equals(req.session.details.hall[0].id) });
                    // console.log("agent in the list",agent);
                    if (agent && !agent.isReady) {
                        isReady = false;
                    }
                }

                let dataGame = {
                    _id: data[i]._id,
                    gameNumber: data[i].gameNumber,
                    gameName: data[i].gameName,
                    startTime: moment(data[i].startDate).format("HH:mm"),
                    startTimeTemp: moment(data[i].startDate),
                    ticketColorPrice: ticket,
                    //ticketPrice: ticket,
                    totalTicketsSold: data[i].ticketSold,
                    earnedFromTickets: +parseFloat(data[i].earnedFromTickets).toFixed(2),
                    totalWinning: +parseFloat(data[i].totalWinning).toFixed(2),
                    profit: +parseFloat(data[i].finalGameProfitAmount + data[i].otherData.elvisReceivedReplaceAmount).toFixed(2),
                    profitPercentage: +parseFloat(data[i].finalGameProfitAmount + data[i].otherData.elvisReceivedReplaceAmount).toFixed(2),
                    status: (data[i].stopGame == true) ? "stopped" : data[i].status,
                    gameMode: data[i].gameMode,
                    showStartButton: false,
                    timerStart: data[i].timerStart,
                    isJackpotPrizeRequired: (data[i].gameName == "Jackpot" || data[i].gameName == "Innsatsen") ? true : false,
                    jackpotDraw: data[i].jackpotDraw,
                    jackpotPrize: data[i].jackpotPrize,
                    isReady: isReady,
                    // otherdata: otherdata.agents
                    gameSecondaryStatus: (data[i].stopGame == true) ? "stopped" : data[i].otherData.gameSecondaryStatus,
                    elvisReplaceAmount: +parseFloat(data[i].otherData.elvisReceivedReplaceAmount).toFixed(2),
                    tvId: "",
                    jackpotSelectedColors: data[i].gameName == "Jackpot" ? [...new Set(data[i].subGames[0].ticketColorTypes.map(t => t.split(' ')[1]))]   : [],
                    isTestGame: data[i]?.otherData?.isTestGame ?? false,
                }
                gameData.push(dataGame);
            }

            let status = { 'running': 1, 'active': 2, 'completed': 3, 'finish': 4, 'stopped': 5 };
            gameData.sort((a, b) => status[a.gameSecondaryStatus] - status[b.gameSecondaryStatus]);
            let index = gameData.findIndex(x => x.status == 'active');
            if (index >= 0) {
                if (gameData[index].gameMode == "Manual") {
                    let startDate = moment(moment().format("YYYY-MM-DD") + " " + gameData[index].startTimeTemp.format("HH:mm")).tz('UTC');
                    if (moment().tz('UTC') >= startDate) {
                        gameData[index].showStartButton = true;
                    }
                } else {
                    gameData[index].showStartButton = true;
                }


                if (req.session.details.role == 'agent') {  //&& dailySchedule && req.session.details.hall[0].id !== dailySchedule.masterhall.id

                    let stringReplace = req.session.details.isPermission['Games Management'];
                    if (!stringReplace) {
                        gameData[index].showStartButton = false;
                    }
                }

            }

            // update tvid for the games to open tv Screen
            if (gameData.length > 0) {
                let groupOfHall = await Sys.App.Services.GroupHallServices.getSingleGoh({ _id: data[0].groupHalls[0].id }, { tvId: 1 });
                if (groupOfHall && groupOfHall.tvId) {
                    gameData.forEach(item => {
                        item.tvId = groupOfHall.tvId;
                    });
                }
            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in getCurrentSubgames", e);
        }
    },

    editSubgame: async function (req, res) {
        try {
            let keys = [
                "view_sub_game",
                "add_physical_tickets",
                "data_update_successfully",
                "something_went_wrong",
                "game",
                "select",
                "hall_name",
                "select_agent",
                "final_id_of_stack",
                "add_winnings",
                "winning_amount",
                "add",
                "sub_game",
                "start_time",
                "end_time_with_last_game_note",
                "custom_game_name",
                "custom_game_name_is_required",
                "notification_start_time",
                "minimum_seconds_to_display_single_ball",
                "maximum_seconds_to_display_single_ball",
                "total_second_to_display_single_ball",
                "ticket_color_type_price",
                "row_pattern_prize",
                "jackpot_prize_and_draws",
                "price_to_replace_elvis_tickets",
                "total_number_displayed",
                "game_player_view",
                "player_name",
                "group_of_hall_name",
                "ticket_color_type",
                "group_of_hall",
                "ticket_number",
                "ticket_price",
                "unique_id",
                "game_name",
                "ticket_purchased_from",
                "winning_pattern",
                "total_winnings",
                "spin_wheel_winnings",
                "treasure_chest_winnings",
                "mystry_winnings",
                "color_draft_winnings",
                "start_date_Time",
                "user_type",
                "select_hall",
                "submit",
                "scan",
                "end_time",
                "scanned_tickets",
                "ticket_type",
                "initial_id",
                "final_id",
                "dashboard",
                "start",
                "cancel",
                "confirm_jackpot_draw",
                "jackpot_prize_and_draw",
                "jackpot_yellow_prize",
                "jackpot_white_prize",
                "jackpot_purple_prize",
                "search_by_ticketid_color",
                "yes_delete",
                "no_cancle",
                "deleted",
                "cancelled",
                "physical_ticket_deleted_success",
                "physical_ticket_not_deleted",
                "sure_want_to_remove_all_physical_ticket",
                "sure_want_to_delete_physical_ticket",
                "not_be_able_to_recover_physical_ticket",
                "draw",
                "jackpot_draw",
                "active",
                "upcoming",
                "stopped",
                "all",
                "view_game",
                "edit_game",
                "start",
                "yes",
                "no",
                "search",
                "show",
                "entries",
                "previous",
                "next",
                "seconds",
                "minseconds",
                "maxseconds",
                "enter",
                "jackpot_prize_of_yellow_ticket",
                "jackpot_prize_of_white_ticket",
                "jackpot_prize_of_purple_ticket",
                "jackpot_draw",
                "price",
                "edit",
                "price",
                "jackpot_prize_must_between_5k_50k",
                "jackpot_draw_between_50_57",
                "jackpot_draw_between_55_59"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let game = await Sys.App.Services.GameService.getGamesByData({ _id: req.params.id }, { gameName: 1, subGames: 1, startDate: 1, graceDate: 1, notificationStartTime: 1, seconds: 1, parentGameId: 1, jackpotDraw: 1, jackpotPrize: 1, otherData: 1 }, {});
            console.log("translate---", translate)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                game: game[0],
                startDate: moment(game[0].startDate).format("HH:MM"),
                endDate: moment(game[0].graceDate).format("HH:MM"),
                subGameList: subGames,
                slug: 'Edit',
                translate,
                navigation: translate
            };
            return res.render('dailySchedules/editSubgame', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editSubgamePostData: async function (req, res) {
        try {
            //console.log("subgame--", req.body);
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id }, { subGames: 1, parentGameId: 1, gameName: 1 });
            //console.log("game", game.subGames[0].options)
            let subgames = [];
            let jackpotPrize = 0;
            let jackpotDraw = 0;
            let replaceTicketPrice = 0;

            if (req.body.subGame.length > 0) {
                for (let i = 0; i < req.body.subGame.length; i++) {
                    let ticketTypeObj = { ticketColorTypes: [], options: [] };
                    let ticketType = req.body.subGame[i].ticketColorType;
                    let ticketPrice = req.body.subGame[i].ticketColorTypePrice;
                    let ticketPrize = req.body.subGame[i].prize;
                    let minimumWinningPrize = {};
                    if (game.gameName == "Spillerness Spill" || game.gameName == "Spillerness Spill 2") {
                        minimumWinningPrize = req.body.subGame[i].minimumPrize;
                    }
                    if (ticketType.length > 0) {
                        ticketTypeObj.ticketColorTypes = ticketType;
                        for (let t = 0; t < ticketType.length; t++) {
                            let purchasedTicketCount = 0;
                            let index = game.subGames[0].options.findIndex(x => x.ticketName == ticketType[t]);
                            if (index >= 0) {
                                purchasedTicketCount = game.subGames[0].options[index].totalPurchasedTickets;
                            }
                            let priceTemp = (ticketPrice[0][ticketType[t]] != "" ? + ticketPrice[0][ticketType[t]] : 0)
                            if (game.gameName == "Traffic Light" || game.gameName == "Elvis") {
                                priceTemp = ticketPrice[0][ticketType[0]];
                            }
                            ticketTypeObj.options.push({ ticketName: ticketType[t], ticketPrice: priceTemp, winning: ticketPrize[ticketType[t].slice(6)], totalPurchasedTickets: purchasedTicketCount, minimumWinning: minimumWinningPrize[ticketType[t].slice(6)] })
                        }
                    }
                    console.log("ticketTypeObj", ticketTypeObj)
                    subgames.push({
                        notificationStartTime: req.body.subGame[i].notificationStartTime,
                        minseconds: req.body.subGame[i].minseconds,
                        maxseconds: req.body.subGame[i].maxseconds,
                        seconds: req.body.subGame[i].seconds,
                        ticketTypesData: ticketTypeObj,
                        custom_game_name: req.body.subGame[i].custom_game_name
                    })

                    if (game.gameName == "Jackpot") {
                        //jackpotPrize = req.body.subGame[i].jackpotPrize;
                        jackpotDraw = req.body.subGame[i].jackpotDraw;
                        jackpotPrize = {
                            'white': req.body.subGame[i].jackpotPrizeWhite,
                            'yellow': req.body.subGame[i].jackpotPrizeYellow,
                            'purple': req.body.subGame[i].jackpotPrizePurple
                        }
                    }
                    if (game.gameName == "Elvis") {
                        replaceTicketPrice = req.body.subGame[i].replace_price;
                    }
                    if (game.gameName == "Innsatsen") {
                        jackpotDraw = req.body.subGame[i].jackpotInnsatsenDraw;
                    }
                }

            }
            //console.log("final subgame", subgames)
            let updatedGame = await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, {
                notificationStartTime: subgames[0].notificationStartTime,
                seconds: subgames[0].seconds,
                subGames: subgames[0].ticketTypesData,
                jackpotPrize: jackpotPrize,
                jackpotDraw: jackpotDraw,
                'otherData.replaceTicketPrice': replaceTicketPrice,
                'otherData.minseconds': subgames[0].minseconds,
                'otherData.maxseconds': subgames[0].maxseconds,
                'otherData.customGameName': subgames[0].custom_game_name
            });

            if (!updatedGame) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/edit-subgame/' + req.params.id);
            } else {
                Sys.Io.of(Sys.Config.Namespace.Game1).to(req.params.id).emit('adminRefreshRoom', {});
                let {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(req.params.id);
                //let patternList = patternListing.patternList;

                //let room = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id }, { jackpotPrize: 1, jackpotDraw: 1, subGames: 1, gameName: 1, withdrawNumberList: 1, parentGameId: 1 });
                // Jackpot games count and winnings
                // const jackPotData = await Sys.Game.Game1.Controllers.GameController.getJackpotData(
                //     room.gameName,
                //     room.withdrawNumberList.length,
                //     room.jackpotDraw,
                //     room.jackpotPrize,
                //     room.subGames,
                //     room.parentGameId
                // );

                Sys.Io.of(Sys.Config.Namespace.Game1).to(req.params.id).emit('PatternChange', { patternList: patternList, jackPotData: jackPotData });
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["sub_game_update"], req.session.details.language));
                return res.redirect('/viewDailySchduleDetails/' + game.parentGameId);
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    viewSubgame: async function (req, res) {
        try {
            let keys = [
                "view_sub_game",
                "add_physical_tickets",
                "data_update_successfully",
                "something_went_wrong",
                "game",
                "select",
                "hall_name",
                "select_agent",
                "final_id_of_stack",
                "add_winnings",
                "winning_amount",
                "add",
                "sub_game",
                "start_time",
                "end_time_with_last_game_note",
                "custom_game_name", 
                "notification_start_time",
                "minimum_seconds_to_display_single_ball",
                "maximum_seconds_to_display_single_ball",
                "total_second_to_display_single_ball",
                "ticket_color_type_price",
                "row_pattern_prize",
                "jackpot_prize_and_draws",
                "price_to_replace_elvis_tickets",
                "total_number_displayed",
                "game_player_view",
                "player_name",
                "group_of_hall_name",
                "ticket_color_type",
                "group_of_hall",
                "ticket_number",
                "ticket_price",
                "unique_id",
                "game_name",
                "ticket_purchased_from",
                "winning_pattern",
                "total_winnings",
                "spin_wheel_winnings",
                "treasure_chest_winnings",
                "mystry_winnings",
                "color_draft_winnings",
                "start_date_Time",
                "user_type",
                "select_hall",
                "submit",
                "scan",
                "end_time",
                "scanned_tickets",
                "ticket_type",
                "initial_id",
                "final_id",
                "dashboard",
                "start",
                "cancel",
                "confirm_jackpot_draw",
                "jackpot_prize_and_draw",
                "jackpot_yellow_prize",
                "jackpot_white_prize",
                "jackpot_purple_prize",
                "search_by_ticketid_color",
                "yes_delete",
                "no_cancle",
                "deleted",
                "cancelled",
                "physical_ticket_deleted_success",
                "physical_ticket_not_deleted",
                "sure_want_to_remove_all_physical_ticket",
                "sure_want_to_delete_physical_ticket",
                "not_be_able_to_recover_physical_ticket",
                "draw",
                "jackpot_draw",
                "active",
                "upcoming",
                "stopped",
                "all",
                "view_game",
                "edit_game",
                "start",
                "yes",
                "no",
                "search",
                "show",
                "entries",
                "previous",
                "next",
                "seconds",
                "minseconds",
                "maxseconds",
                "enter",
                "jackpot_prize_of_yellow_ticket",
                "jackpot_prize_of_white_ticket",
                "jackpot_prize_of_purple_ticket",
                "jackpot_draw",
                "price",
                "is_testing_game"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let game = await Sys.App.Services.GameService.getGamesByData({ _id: req.params.id }, { gameName: 1, subGames: 1, startDate: 1, graceDate: 1, notificationStartTime: 1, seconds: 1, minseconds: 1, maxseconds: 1, parentGameId: 1, groupHalls: 1, jackpotDraw: 1, jackpotPrize: 1, withdrawNumberList: 1, otherData: 1 }, {});
            let groupOfHalls = [];
            if (game.length > 0) {
                if (game[0].groupHalls && game[0].groupHalls.length > 0) {
                    for (let g = 0; g < game[0].groupHalls.length; g++) {
                        let selectedHalls = [];
                        if (game[0].groupHalls[g].selectedHalls && game[0].groupHalls[g].selectedHalls.length > 0) {
                            for (let h = 0; h < game[0].groupHalls[g].selectedHalls.length; h++) {
                                selectedHalls.push({ name: game[0].groupHalls[g].selectedHalls[h].name, id: game[0].groupHalls[g].selectedHalls[h].id });
                            }
                        }
                        groupOfHalls.push({ name: game[0].groupHalls[g].name, id: game[0].groupHalls[g].id, halls: selectedHalls });
                    }
                }
            }
            let agentHalls = [];
            if (req.session.details.role == 'agent') {
                for (let i = 0; i < groupOfHalls.length; i++) {
                    for (let j = 0; j < groupOfHalls[i].halls.length; j++) {
                        if (req.session.details.hall[0].id == groupOfHalls[i].halls[j].id) {
                            agentHalls.push({
                                name: groupOfHalls[i].name,
                                id: groupOfHalls[i].id,
                                halls: [{
                                    name: groupOfHalls[i].halls[j].name,
                                    id: groupOfHalls[i].halls[j].id
                                }
                                ]
                            })
                        }
                    }
                }
            }
            console.log("groupOfHalls", groupOfHalls, agentHalls);
            let allHalls = await Sys.App.Services.HallServices.getAllHallDataSelect({ status: "active" }, { name: 1 });
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                game: game[0],
                startDate: moment(game[0].startDate).format("HH:MM"),
                endDate: moment(game[0].graceDate).format("HH:MM"),
                subGameList: subGames,
                groupOfHalls: (req.session.details.role == 'agent') ? agentHalls : groupOfHalls,
                slug: 'View',
                allHalls: allHalls,
                translate: translate,
                navigation: translate
            };
            return res.render('dailySchedules/viewSubgame', data);
        } catch (e) {
            console.log("Error in viewSubgame", e)
        }
    },

    getGameAgents: async function (req, res) {
        try {
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.query.gameId }, { otherData: 1 }, {});
            let readyAgents = [];
            let notReadyagents = [];
            if (game && game.otherData && game.otherData.agents.length > 0) {
                for (let s = 0; s < game.otherData.agents.length; s++) {
                    if (game.otherData.agents[s].isReady == true) {
                        readyAgents.push({ name: game.otherData.agents[s].name, hallName: game.otherData.agents[s].hallName })
                    } else {
                        notReadyagents.push({ name: game.otherData.agents[s].name, hallName: game.otherData.agents[s].hallName })
                    }
                }
            }
            console.log("req game getGameAgents ::", game.otherData?.agents.length);
            // let halls = [];
            // if(game && game.groupHalls && game.groupHalls.length > 0){
            //     for(let g=0; g < game.groupHalls.length; g++){
            //         for(let s=0; s < game.groupHalls[g].selectedHalls.length; s++){
            //             halls.push(game.groupHalls[g].selectedHalls[s].id)
            //         }
            //     }
            // }
            // console.log("halls ", halls);
            // let hallData = await Sys.App.Services.HallServices.getAllHallDataSelect({_id: {$in: halls} }, {agents: 1})
            // console.log("halldata", hallData);
            // let agents = [];
            // if(hallData && hallData.length > 0){
            //     for(let s=0; s < hallData.length; s++){
            //         if(Object.keys(hallData[s].agents).length > 0){
            //             agents.push(hallData[s].agents)
            //         }
            //     }
            // }
            // console.log("agents", agents);
            return res.send({
                "status": "success",
                "readyAgents": readyAgents,
                "notReadyagents": notReadyagents
            });
        } catch (e) {
            console.log("Error in getGameAgents", e)
            return res.send({
                "status": "fail",
                "readyAgents": [],
                "notReadyagents": []
            });
        }
    },

    agentReady: async function (req, res) {
        try {
            console.log("agentReady api called", req.body);
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.gameId }, { otherData: 1 }, {});
            let data = await Sys.App.Services.GameService.updateGameData(
                { _id: game._id, "otherData.agents.id": mongoose.Types.ObjectId(req.body.agentId) }, //"otherData.agents.hallId": mongoose.Types.ObjectId(req.session.details.hall[0].id)
                { $set: { "otherData.agents.$[].isReady": true } }
            );
            if (data) {
                return res.send({
                    "status": "success"
                });
            } else {
                throw new Error('Something Went Wrong.')
            }
        } catch (e) {
            console.log("Error in getGameAgents", e)
            return res.send({
                "status": "fail"
            });
        }
    },

    startManualGame: async function (req, res) {
        try {
            console.log("start manual game params", req.body)
            if (req.body.id) {
                let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id }, { status: 1, gameMode: 1, notificationStartTime: 1, players: 1, parentGameId: 1 ,gameName :1 }, {});
                console.log("game", game);

                // check for closed dates
                if (game && game.status == "active" && game.gameMode == "Manual") {
                    let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: game.parentGameId }, { otherData: 1 }, {});
                    console.log("schedule", schedule, schedule.otherData.closeDay);
                    if (schedule.otherData.closeDay && schedule.otherData.closeDay.length > 0) {
                        for (let c = 0; c < schedule.otherData.closeDay.length; c++) {
                            if (moment() >= schedule.otherData.closeDay[c].utcDates.startTime && moment() <= schedule.otherData.closeDay[c].utcDates.endTime) {
                                return res.send({
                                    "status": "fail",
                                    "message": await Sys.Helper.bingo.getSingleTraslateData(["can_not_start_game_schedule_close_moment"], req.session.details.language),
                                });
                            }
                        }
                    }
                }
                // check for closed dates

                if (game.gameMode == 'Manual' && (req.body.jackpotPrizeWhite || req.body.jackpotPrizeYellow || req.body.jackpotPrizePurple) && req.body.jackpotDraw) {
                    // Need to work, update Jackpot Prize and draw
                    let jackpotPrize = {
                        'white': +req.body.jackpotPrizeWhite || 0,
                        'yellow': +req.body.jackpotPrizeYellow || 0,
                        'purple': +req.body.jackpotPrizePurple || 0
                    }
                    await Sys.Game.Game1.Services.GameServices.updateGameNew(game._id, { jackpotDraw: req.body.jackpotDraw, jackpotPrize: jackpotPrize });
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(req.body.id).emit('adminRefreshRoom', {});
                    let {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(req.body.id);
                    //let patternList = patternListing.patternList;

                    //let room = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id }, { jackpotPrize: 1, jackpotDraw: 1, subGames: 1, gameName: 1, withdrawNumberList: 1, parentGameId: 1 });
                    // Jackpot games count and winnings
                    // const jackPotData = await Sys.Game.Game1.Controllers.GameController.getJackpotData(
                    //     room.gameName,
                    //     room.withdrawNumberList.length,
                    //     room.jackpotDraw,
                    //     room.jackpotPrize,
                    //     room.subGames,
                    //     room.parentGameId
                    // );

                    Sys.Io.of(Sys.Config.Namespace.Game1).to(req.body.id).emit('PatternChange', { patternList: patternList, jackPotData: jackPotData });
                } else if (game.gameMode == 'Manual' && req.body.jackpotDraw) {
                    await Sys.Game.Game1.Services.GameServices.updateGameNew(game._id, { jackpotDraw: req.body.jackpotDraw });
                }
               
                if (game.status == "active") {
                    if (Timeout.exists(game._id.toString())) {
                        console.log("timeout already exists", game._id.toString())
                        return res.send({
                            "status": "fail",
                            "message": await Sys.Helper.bingo.getSingleTraslateData(["game_started"], req.session.details.language)
                        });
                    } else {
                        console.log("timeout not exists.")
                    }

                    if (game.gameMode == 'Manual') {
                        let tempIndex = Sys.Timers.indexOf(game._id.toString());
                        if (tempIndex !== -1) {
                            if (Timeout.exists(game._id.toString())) {
                                console.log("timeout already exists check in new timer set up", game._id.toString())
                                return res.send({
                                    "status": "fail",
                                    "message": await Sys.Helper.bingo.getSingleTraslateData(["game_started"], req.session.details.language)
                                });
                            }
                            Sys.Timers.splice(tempIndex, 1);
                        }
                        let indexId = Sys.Timers.push(game._id.toString());
                        console.log("indexId---", indexId,);

                        let remainedTimeTostartGame = 0;
                        let TimeMessage = "";
                        let TimeType = game.notificationStartTime.slice(-1);
                        if (TimeType == "m") {
                            let notificationTime = game.notificationStartTime.length <= 2 ? (game.notificationStartTime.substring(0, 1)) : (game.notificationStartTime.substring(0, 2));
                            remainedTimeTostartGame = notificationTime * 60;
                            TimeMessage = {
                                en: await translate({ key: "manual_game_start_minute", language: 'en', isDynamic: true, number: notificationTime ,number1 :game.gameName}),
                                nor: await translate({ key: "manual_game_start_minute", language: 'nor', isDynamic: true, number: notificationTime ,number1 :game.gameName})
                            };
                            //"The game Will Start in Next " + notificationTime + " Minutes";
                        } else {
                            remainedTimeTostartGame = game.notificationStartTime.length <= 2 ? (game.notificationStartTime.substring(0, 1)) : (game.notificationStartTime.substring(0, 2));
                            TimeMessage = {
                                en: await translate({ key: "manual_game_start_second", language: 'en', isDynamic: true, number: remainedTimeTostartGame ,number1 :game.gameName }),
                                nor: await translate({ key: "manual_game_start_second", language: 'nor', isDynamic: true, number: remainedTimeTostartGame , number1 :game.gameName })
                            };
                            //"The game Will Start in Next " + remainedTimeTostartGame + " Seconds";
                        }
                        console.log("remainedTimeTostartGame---", remainedTimeTostartGame, (remainedTimeTostartGame - 5))
                        await Promise.all(
                            game.players.map(async (player) => {
                                const isRunningGame = await checkGamePlayAtSameTimeForRefund(player, game._id);
                                if (isRunningGame?.status) {
                                const socketId = player.socketId?.split('#')?.[1];
                                if (!socketId) return;
                                await Sys.Game.Common.Controllers.PlayerController.CheckForRefundAmount(
                                    socketId,
                                    {
                                        playerId: player.id.toString(),
                                        gameId: game._id,
                                        hallIds: isRunningGame.hallIds
                                        }
                                    );
                                }
                            })
                        );

                        let playerIds = [];
                        let bulkArr = [];
                        let notification = {};
                        for (let p = 0; p < game.players.length; p++) {
                            notification = {
                                notificationType: 'gameStartReminder',
                                message: TimeMessage
                            }
                            bulkArr.push({
                                insertOne: {
                                    document: {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }
                                }
                            })
                            if (game.players[p].userType != "Physical") {
                                playerIds.push(game.players[p].id);
                            }
                        }
                        Sys.Helper.gameHelper.sendNotificationToPlayers(game, playerIds, TimeMessage, notification.notificationType);
                        Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                        await Sys.Game.Common.Services.GameServices.updateGame({ _id: game._id }, { $set: { isNotificationSent: true, timerStart: true } });
                        Sys.Io.of('admin').emit('updateSubgameTable', { gameId: game._id });

                        Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                            try {
                                console.log("---inside setTimeout---", game._id);

                                await Sys.Game.Game1.Services.GameServices.updateGameNew(game._id, { $set: { "otherData.disableCancelTicket": true } });  //disableTicketPurchase: true
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(game._id).emit('refreshUpcomingGames', {});
                                // refresh upcoming and all game list

                                let index = Sys.Timers.indexOf(game._id.toString());
                                if (index !== -1) {
                                    Timeout.clear(Sys.Timers[index], erase = true);
                                    Sys.Timers.splice(index, 1);
                                }

                                //await Sys.Game.Common.Controllers.GameController.updateGame1TicketIds(game._id);  now we will do this functionality from ticket purchase and cancel

                                // Now start game 1 after 5 seconds
                                let delay = 5000;
                                if (remainedTimeTostartGame < 5) {
                                    delay = (remainedTimeTostartGame * 1000);
                                }
                                setTimeout(async function () {
                                    let updatedDataOfGame = await Sys.Game.Common.Services.GameServices.getSingleGameData({ _id: game._id });
                                    if (updatedDataOfGame.status == 'active') {
                                        console.log('<====================================================================>');
                                        console.log('<=>                   || StartGame Game1 Starting (Manual) ||                   <=>');
                                        console.log('\x1b[36m%s\x1b[0m', '[ Game Details ]: ', updatedDataOfGame._id);
                                        console.log('\x1b[36m%s\x1b[0m', '[ Game Number ]: ', updatedDataOfGame.gameNumber);
                                        console.log('\x1b[36m%s\x1b[0m', '[ Game Players ]: ', updatedDataOfGame.players.length);
                                        console.log('\x1b[36m%s\x1b[0m', '[ Game Purchase Ticket ]: ', updatedDataOfGame.purchasedTickets.length);
                                        console.log('<====================================================================>');
                                        await Sys.Game.Game1.Services.GameServices.updateGameNew(updatedDataOfGame._id, { $set: { status: 'running', startDate: Date.now() } });
                                        updatedDataOfGame?.halls.forEach(hall => {
                                            Sys.Io.of('admin').to(hall).emit('refresh', { scheduleId: updatedDataOfGame.parentGameId });
                                        })
                                        Sys.Io.of('admin').emit('updateSubgameTable', { gameId: game._id });
                                        let ticketUpdate = [
                                            {
                                                'updateMany': {
                                                    "filter": { "gameId": game._id.toString() },
                                                    "update": { '$set': { "gameStartDate": Date.now() } }
                                                }
                                            }
                                        ]
                                        Sys.App.Services.GameService.bulkWriteTicketData(ticketUpdate);
                                        let transactionUpdate = [
                                            {
                                                'updateMany': {
                                                    "filter": { "gameId": updatedDataOfGame._id.toString() },
                                                    "update": { '$set': { "gameStartDate": Date.now() } }
                                                }
                                            }
                                        ]
                                        Sys.App.Services.GameService.bulkWriteTransactionData(transactionUpdate);
                                        await Sys.Game.Game1.Controllers.GameProcess.StartGame(updatedDataOfGame._id);
                                    }
                                }, delay); //5000



                            } catch (e) {
                                console.log("error in timeout of game 1 start", e);
                            }

                        }, ((remainedTimeTostartGame - 5) * 1000));

                        let secondsToAdd = (+remainedTimeTostartGame + 1);

                        let timerStart = setInterval(async function () {
                            secondsToAdd = secondsToAdd - 1;
                            await Sys.Io.of(Sys.Config.Namespace.Game1).to(game._id).emit('countDownToStartTheGame', {
                                gameId: game._id,
                                count: secondsToAdd
                            });
                            if (secondsToAdd <= 0) {
                                clearInterval(timerStart);
                            }
                        }, 1000);

                        let messageLanguage = "en"
                        if (req.session.details.language == "norwegian") {
                            messageLanguage = "nor";
                        }
                        return res.send({
                            "status": "success",
                            "message": TimeMessage[messageLanguage],
                            "reminingTime": remainedTimeTostartGame
                        });

                    }

                    return res.send({
                        "status": "fail",
                        "message": await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language)
                    });
                } else {
                    return res.send({
                        "status": "fail",
                        "message": await Sys.Helper.bingo.getSingleTraslateData(["Game is already Started."], req.session.details.language)
                    });
                }


            } else {
                return res.send({
                    "status": "fail",
                    "message": await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language)
                });
            }

        } catch (e) {
            console.log("Error in getGameAgents", e)
            return res.send({
                "status": "fail",
                "message": await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language)
            });
        }
    },

    stopGame1: async function (req, res) {
        try {
            console.log("stopGame1 called", req.body)
            if (req.body.id) {
                let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.body.id }, { status: 1, startDate: 1, endDate: 1, startTime: 1, endTime: 1, specialGame: 1, halls: 1 }, {});
                console.log("schedule", schedule);
                if (schedule && schedule.status == "running") {
                    if (schedule.specialGame) {
                        let dataQuery = {
                            _id: { $nin: [schedule._id] },
                            "startDate": { "$lte": schedule.startDate }, // Start date is on or before 02/12/2024
                            "endDate": {
                                "$gte": schedule.endDate
                            },
                            "isSavedGame": false,
                            "stopGame": false,
                        }

                        console.log("dataQuery", dataQuery);

                        let SchedulesData = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {
                            _id: 1, groupHalls: 1, startTime: 1, endTime: 1, masterHall: 1, halls: 1
                        });
                        console.log("SchedulesData", SchedulesData);

                        const checkStartTime = parseTime(schedule.startTime);
                        const checkEndTime = parseTime(schedule.endTime);

                        await Promise.all(SchedulesData.map(async game => {

                            const gameStartTime = parseTime(game.startTime);
                            const gameEndTime = parseTime(game.endTime);

                            // Check for time overlaps
                            if (!(checkStartTime < gameEndTime && checkEndTime > gameStartTime)) return;

                            let query = { parentGameId: game._id, status: "active", isChangeforSpecailGame: true };

                            console.log("query", query);

                            let gameData = await Sys.App.Services.GameService.getByData(
                                query,
                            );

                            console.log("gameData", gameData);

                            if (gameData.length) {
                                let query = { parentGameId: gameData[0].parentGameId, status: "active" };
                                await Sys.App.Services.GameService.updateManyGameData(
                                    query,
                                    {
                                        $set: {
                                            halls: gameData[0].removeForSpecailGame.halls,
                                            groupHalls: gameData[0].removeForSpecailGame.groupHalls,
                                            allHallsId: gameData[0].removeForSpecailGame.allHallsId,
                                            isChangeforSpecailGame: false,
                                            "stopGame": false,
                                        }
                                    }
                                );
                            }

                            game.halls.forEach(hall => {
                                console.log("Call refresh",);
                                Sys.Io.of('admin').to(hall).emit('pageRefresh', { message: "Ticket Purchase" });
                            })
                        }))

                    }
                    // let games =upcomingGames Event Data await Sys.App.Services.GameService.getGamesByData({parentGameId: req.body.id}, {status: 1, stopGame: 1, timerStart: 1}, {});
                    // console.log("games", games)
                    let updatedSchedule = await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: req.body.id }, { "$set": { "stopGame": true } });
                    console.log("updatedSchedule", updatedSchedule)
                    if (updatedSchedule && updatedSchedule.stopGame == true) {
                        Sys.App.Services.GameService.updateManyGameData({ parentGameId: req.body.id, status: "active" }, { "$set": { "stopGame": true } });
                        // call refund function of game 1 to refund all the upcoming games
                        module.exports.refundStoppedSchedule({ dailyScheudleId: req.body.id })
                    }
                    Sys.Game.Common.Controllers.GameController.updateClosedayGame1(req.body.id);

                    // Send refresh event to all admin halls to update games
                    for (let h = 0; h < schedule?.halls?.length; h++) {
                        Sys.Io.of('admin').to(schedule.halls[h].toString()).emit('refresh', {
                            status: "success",
                            data: { }
                        });
                    }

                    return res.send("success");
                }

            } else {
                return res.send({
                    "status": "fail",
                    "message": await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language)
                });
            }

        } catch (e) {
            console.log("Error in stopGame1", e)
            return res.send({
                "status": "fail",
                "message": await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language)
            });
        }
    },

    refundStoppedSchedule: async function (data) {
        try {
            let games = await Sys.App.Services.GameService.getGamesByData({ parentGameId: data.dailyScheudleId, status: "active" }, { status: 1, stopGame: 1, ticketSold: 1, players: 1, gameNumber: 1, gameName: 1 }, {});
            console.log("games", games.length);
            if (games.length > 0) {
                for (let g = 0; g < games.length; g++) {
                    if (games[g].players.length > 0) {
                        for (let p = 0; p < games[g].players.length; p++) {
                            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: games[g].players[p].id }, { username: 1, socketId: 1 });
                            if (player) {
                                let tiketPrice = games[g].players[p].ticketPrice;
                                let ticketQty = games[g].players[p].totalPurchasedTickets;
                                let purchasedTickets = games[g].players[p].purchaseTicketTypes;
                                let purchasedSlug = games[g].players[p].purchasedSlug;

                                let updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                                    { _id: games[g]._id, 'players.id': games[g].players[p].id },
                                    { $pull: { players: { id: games[g].players[p].id } }, $inc: { ticketSold: -ticketQty, earnedFromTickets: -tiketPrice, finalGameProfitAmount: -tiketPrice } },
                                );
                                console.log("updatedGame in cancelTicket of player", games[g].players[p].id, games[g]._id, updateGame)

                                if (updateGame instanceof Error || updateGame == null || updateGame == undefined) {
                                    console.log("error in cancelling ticket when stopped game", games[g].players[p].id, games[g]._id);
                                } else {
                                    console.log("cancel ticket purchased, revert user amount while stopped game", games[g].players[p].id);

                                    if (purchasedSlug == "points") {
                                        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: games[g].players[p].id }, { $inc: { points: tiketPrice } });
                                        let newExtraTransaction = {
                                            playerId: player._id,
                                            gameId: games[g]._id,
                                            transactionSlug: "extraTransaction",
                                            typeOfTransaction: "Refund",
                                            action: "credit", // debit / credit
                                            purchasedSlug: "points", // point /realMoney
                                            totalAmount: tiketPrice,
                                            game1Slug: "refund"
                                        }
                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                    } else if (purchasedSlug == "realMoney") {
                                        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: games[g].players[p].id }, { $inc: { walletAmount: tiketPrice, monthlyWalletAmountLimit: tiketPrice } });
                                        let newExtraTransaction = {
                                            playerId: player._id,
                                            gameId: games[g]._id,
                                            transactionSlug: "extraTransaction",
                                            typeOfTransaction: "Refund",
                                            action: "credit", // debit / credit
                                            purchasedSlug: "realMoney", // point /realMoney
                                            totalAmount: tiketPrice,
                                            game1Slug: "refund"
                                        }
                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                    }
                                    await updatePlayerHallSpendingData({ playerId: player._id, hallId: '', amount: +tiketPrice, type: 'normal', gameStatus: 2 });
                                    if (purchasedTickets.length > 0) {
                                        let incObj = {};
                                        let filterArr = [];
                                        let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
                                        for (let s = 0; s < purchasedTickets.length; s++) {
                                            incObj["subGames.$[].options.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -(purchasedTickets[s].totalPurchasedTickets);
                                            filterArr.push({ [tempAlpha[s] + ".ticketName"]: purchasedTickets[s].ticketName })
                                        }
                                        Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: games[g]._id }, {
                                            $inc: incObj
                                        }, { arrayFilters: filterArr, new: true });
                                    }

                                    Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: games[g].players[p].id, gameId: games[g]._id });
                                    // update static tickets for predefined tickets flow
                                    Sys.Game.Game1.Services.GameServices.updateManyStaticData({ playerIdOfPurchaser: games[g].players[p].id, isPurchased: true, gameId: games[g]._id }, { isPurchased: false, playerIdOfPurchaser: "", gameId: "" });

                                    //let TimeMessage = games[g].gameNumber + " [ " + games[g].gameName + " ] Ticket Refund Successfully..!! ";
                                    let TimeMessage = {
                                        en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: games[g].gameNumber, number1: games[g].gameName }),
                                        nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: games[g].gameNumber, number1: games[g].gameName })
                                    };
                                    let notification = {
                                        notificationType: 'refundTickets',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: player._id,
                                        gameId: games[g]._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    await Sys.Io.to(player.socketId).emit('NotificationBroadcast', {
                                        notificationType: notification.notificationType,
                                        message: TimeMessage
                                    });
                                    
                                    Sys.Io.to(player.socketId).emit('PlayerHallLimit', { });

                                }

                            }
                        }
                    }
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(games[g]._id).emit('RefreshRoom', {});
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(games[g]._id).emit('adminRefreshRoom', {});
                }
            }
        } catch (e) {
            console.log("Error in refundStoppedSchedule", e)
        }
    },

    deleteSavedDailySchedule: async function (req, res) {
        try {
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.body.id, isSavedGame: true });
            if (schedule || schedule.length > 0) {
                await Sys.App.Services.scheduleServices.deleteDailySchedule({ _id: req.body.id });
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewSavedDailySchedule: async function (req, res) {
        try {
            let keys = [
                "dashboard",
                "view_saved_daily_schedule",
                "special_schedule_management",
                "daily_schedule_management",
                "view_daily_schedule",
                "start_date",
                "end_date",
                "select_time_slot",
                "selected_weekdays",
                "select_schedule_for_each_weeday",
                "select_schedule",
                "grop_of_halls",
                "grop_of_halls_name",
                "master_hall",
                "cancel",
                "view",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.params.id }, {}, {});

            let subgamesList = await Sys.App.Services.scheduleServices.getSchedulesByData({}, { scheduleName: 1, manualStartTime: 1, manualEndTime: 1 }, {});

            let allTimeSlots = [];
            if (subgamesList.length > 0) {
                for (let s = 0; s < subgamesList.length; s++) {
                    let isSelected = false;
                    if (subgamesList[s].manualStartTime != "" && subgamesList[s].manualEndTime != "") {
                        if (subgamesList[s].manualStartTime == schedule.startTime && subgamesList[s].manualEndTime == schedule.endTime) {
                            isSelected = true;
                        }
                        allTimeSlots.push({ startTime: subgamesList[s].manualStartTime, endTime: subgamesList[s].manualEndTime, isSelected: isSelected });
                    }
                }
            }
            let uniqueTimeSlots = allTimeSlots.filter((v, i, a) => a.findIndex(v2 => ['startTime', 'endTime'].every(k => v2[k] === v[k])) === i);
            let sortedTimeSlots = uniqueTimeSlots.sort((a, b) => a.startTime > b.startTime ? 1 : -1);

            let schedulesBasedSlot = await Sys.App.Services.scheduleServices.getSchedulesByData({ manualStartTime: schedule.startTime, manualEndTime: schedule.endTime }, { scheduleName: 1 }, {});

            let days = [];
            let selectedSubGames = [];
            if (Object.keys(schedule.days).length) {
                days = Object.keys(schedule.days);
                for (const day in schedule.days) {
                    selectedSubGames.push({ day: day, selectedSchedule: schedule.days[day][0] });
                }
            }

            let groupOfHallsIds = [];
            let groupOfHalls = [];
            let availableForSelectionMasterHals = [];
            let allHalls = [];
            if (schedule.groupHalls.length > 0) {
                for (let g = 0; g < schedule.groupHalls.length; g++) {
                    groupOfHallsIds.push(schedule.groupHalls[g].id);
                    groupOfHalls.push(schedule.groupHalls[g]);
                    if (schedule.groupHalls[g].selectedHalls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].selectedHalls.length; h++) {
                            availableForSelectionMasterHals.push(schedule.groupHalls[g].selectedHalls[h]);
                        }
                    }

                    if (schedule.groupHalls[g].halls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].halls.length; h++) {
                            allHalls.push(schedule.groupHalls[g].halls[h]);
                        }
                    }
                }
            }

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                subGameList: schedulesBasedSlot, //subgamesList,
                scheduleId: schedule._id,
                groupHallArray: groupOfHalls,
                groupOfHallsIds: groupOfHallsIds,
                startDate: moment(new Date(schedule.startDate)).tz('UTC').format('YYYY-MM-DD'),
                endDate: moment(new Date(schedule.endDate)).tz('UTC').format('YYYY-MM-DD'),
                days: days,
                selectedSubGames: selectedSubGames,
                availableForSelectionMasterHals: availableForSelectionMasterHals,
                masterHall: schedule.masterHall.id,
                allHalls: allHalls,
                slug: 'View',
                isSavedGameView: true,
                timeSlots: sortedTimeSlots,
                specialGame: schedule.specialGame,
                translate: translate,
                navigation: translate
            };
            return res.render('dailySchedules/view', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editSavedDailySchedule: async function (req, res) {
        try {
            let keys = [
                "daily_schedule_management",
                "dashboard",
                "edit_daily_schedule",
                "save_game",
                "save_as",
                "enter_name_of_daily_schedule",
                "please",
                "save",
                "start_date",
                "end_date",
                "select_time_slot",
                "select_weekdays",
                "select_schedule_for_each_weeday",
                "select_schedule",
                "select_group_of_halls",
                "select_halls",
                "select_master_hall",
                "submit",
                "cancel",
                "created",
                "error",
                "daily_schedule_aved_success",
                "minimum_1_day_gap"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.params.id }, {}, {});
            if (schedule && (schedule.status == "running" || schedule.stopGame == true)) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language));
                return res.redirect('/savedGameList');
            }
            let subgamesList = await Sys.App.Services.scheduleServices.getSchedulesByData({}, { scheduleName: 1, manualStartTime: 1, manualEndTime: 1 }, {});

            let allTimeSlots = [];
            if (subgamesList.length > 0) {
                for (let s = 0; s < subgamesList.length; s++) {
                    let isSelected = false;
                    if (subgamesList[s].manualStartTime != "" && subgamesList[s].manualEndTime != "") {
                        if (subgamesList[s].manualStartTime == schedule.startTime && subgamesList[s].manualEndTime == schedule.endTime) {
                            isSelected = true;
                        }
                        allTimeSlots.push({ startTime: subgamesList[s].manualStartTime, endTime: subgamesList[s].manualEndTime, isSelected: isSelected });
                    }
                }
            }
            let uniqueTimeSlots = allTimeSlots.filter((v, i, a) => a.findIndex(v2 => ['startTime', 'endTime'].every(k => v2[k] === v[k])) === i);
            let sortedTimeSlots = uniqueTimeSlots.sort((a, b) => a.startTime > b.startTime ? 1 : -1);

            let schedulesBasedSlot = await Sys.App.Services.scheduleServices.getSchedulesByData({ manualStartTime: schedule.startTime, manualEndTime: schedule.endTime }, { scheduleName: 1 }, {});

            let days = [];
            let selectedSubGames = [];
            if (Object.keys(schedule.days).length) {
                days = Object.keys(schedule.days);
                for (const day in schedule.days) {
                    selectedSubGames.push({ day: day, selectedSchedule: schedule.days[day][0] });
                }
            }

            let groupOfHallsIds = [];
            let groupOfHalls = [];
            let availableForSelectionMasterHals = [];
            let allHalls = [];

            // code for saved game

            if (schedule.groupHalls.length > 0) {
                for (let g = 0; g < schedule.groupHalls.length; g++) {
                    groupOfHallsIds.push(schedule.groupHalls[g].id);
                    groupOfHalls.push(schedule.groupHalls[g]);
                    if (schedule.groupHalls[g].selectedHalls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].selectedHalls.length; h++) {
                            availableForSelectionMasterHals.push(schedule.groupHalls[g].selectedHalls[h]);
                        }
                    }
                }
            }
            console.log("selected groupOfHallsIds", groupOfHalls, groupOfHallsIds, availableForSelectionMasterHals)

            let availableGroups = [];
            if (schedule.startDate !== '' && schedule.endDate !== '') {
                startDate = new Date(schedule.startDate);
                endDate = new Date(schedule.endDate);
                if (startDate !== '' && endDate !== '') {
                    let halls = await module.exports.findAvailableHallsBasedSlots(req.session.details, startDate, endDate, schedule.startTime, schedule.endTime);
                    console.log("halls for saved game", halls)
                    if (halls.status == "success") {
                        console.log("groups---", halls.groupHalls.groupHallsAvailable);
                        console.log("halls", halls.groupHalls.allHalls)
                        availableGroups = halls.groupHalls.groupHallsAvailable
                    }
                }
            }

            let finalGroupOfHalls = [];
            let finalGroupOfHallIds = [];
            let finalAvailableForSelectionMasterHals = [];
            let finalAllHalls = [];

            availableGroups = JSON.parse(JSON.stringify(availableGroups))

            if (availableGroups.length > 0) {
                for (let a = 0; a < availableGroups.length; a++) {
                    if (groupOfHallsIds.includes(availableGroups[a]._id) == true) {
                        availableGroups[a].isnotSelected = false;

                        let index = groupOfHalls.findIndex(x => x.id == availableGroups[a]._id);
                        let selectedHalls = [];
                        if (index >= 0) {

                            if (groupOfHalls[index].selectedHalls.length > 0) {
                                for (let h = 0; h < groupOfHalls[index].selectedHalls.length; h++) {
                                    console.log("selected hall ids", groupOfHalls[index].selectedHalls[h], availableGroups[a].halls)

                                    let isavailable = availableGroups[a].halls.findIndex(x => x.id == groupOfHalls[index].selectedHalls[h].id);
                                    console.log("isavailable--", isavailable)
                                    if (isavailable >= 0) {
                                        selectedHalls.push(groupOfHalls[index].selectedHalls[h]);
                                    }
                                }
                            }
                        }
                        availableGroups[a].selectedHalls = selectedHalls;
                        console.log("selected hall", availableGroups[a].selectedHalls)


                    } else {
                        availableGroups[a].isnotSelected = true;
                    }
                    availableGroups[a].id = availableGroups[a]._id;
                    finalGroupOfHalls.push(availableGroups[a]);
                    finalGroupOfHallIds.push(availableGroups[a]._id);
                    finalAllHalls.push(...availableGroups[a].halls);
                }
                if (availableForSelectionMasterHals.length > 0 && finalAllHalls.length > 0) {
                    let index = finalAllHalls.findIndex(x => x.id == availableForSelectionMasterHals[0].id);
                    if (index >= 0) {
                        finalAvailableForSelectionMasterHals = availableForSelectionMasterHals
                    }
                }
            }
            console.log("finalGroupOfHalls", finalGroupOfHalls, finalGroupOfHallIds, finalAllHalls, finalAvailableForSelectionMasterHals)
            //

            // let availHalls =await module.exports.findAvailableHallForEdit(req.params.id)
            // console.log("availHalls", availHalls)
            // if(availHalls.status == "success"){
            //     groupOfHallsIds = availHalls.groupHalls.groupOfHallsIds;
            //     groupOfHalls = availHalls.groupHalls.groupOfHalls;
            //     availableForSelectionMasterHals = availHalls.groupHalls.availableForSelectionMasterHals;
            //     allHalls = availHalls.groupHalls.allHalls;
            // }
            // console.log("availableForSelectionMasterHals", groupOfHalls, groupOfHallsIds, availableForSelectionMasterHals, allHalls);
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                subGameList: schedulesBasedSlot, //subgamesList,
                scheduleId: schedule._id,
                groupHallArray: finalGroupOfHalls,
                groupOfHallsIds: finalGroupOfHallIds,
                startDate: moment(new Date(schedule.startDate)).tz('UTC').format('YYYY-MM-DD'),
                endDate: moment(new Date(schedule.endDate)).tz('UTC').format('YYYY-MM-DD'),
                days: days,
                selectedSubGames: selectedSubGames,
                availableForSelectionMasterHals: finalAvailableForSelectionMasterHals,
                masterHall: schedule.masterHall.id,
                allHalls: finalAllHalls,
                slug: 'Edit',
                isSavedGameEdit: true,
                timeSlots: sortedTimeSlots,
                translate,
                navigation: translate
            };
            return res.render('dailySchedules/create', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    availableHalls: async function (startDate, endDate) {
        try {

        } catch (e) {
            return {
                "status": "error",
                "halls": []
            };
        }
    },

    viewGameHistory: async function (req, res) {
        try {
            //console.log("viewGameHistory of schedule called", req.query, req.params)
            let sort = {};
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let gameData = [];
            let query = {
                gameType: 'game_1',
                gameId: req.params.id,
                userType: ((req.query.userType).trim()),
                playerTicketType: "Online",
                isPhysicalTicket: false
            }
            let hallId = req.query.hall;
            let groupHallId = req.query.goh;
            if (hallId != "All") {
                query.hallId = hallId;
            }
            if (groupHallId != "All") {
                query.groupHallId = groupHallId;
            }

            if (req.session.details.role == "agent") {
                query.hallId = req.session.details.hall[0].id;
                delete query.groupHallId
            }

            if (search != '') {
                query.playerNameOfPurchaser = { $regex: `.*${search}.*`, $options: 'i' }
            }
            let data = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: req.params.id }, { subGames: 1, startDate: 1, status: 1 });
            if (data.status == "finish" || data.status == "running") {
                sort = { isPlayerWon: -1, totalWinningOfTicket: -1 };
            }
            let ticketsCount = await Sys.App.Services.GameService.getTicketCount(query);
            let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);

            if (ticketInfo.length > 0) {
                for (let j = 0; j < ticketInfo.length; j++) {
                    let amount = 0;
                    if (ticketInfo[j]?.otherData?.winningStats) {
                        ticketInfo[j]?.otherData?.winningStats?.forEach(stats => {
                            amount += stats.wonAmount;
                        });
                    }

                    let userType = "-";
                    if (ticketInfo[j].userType) {
                        userType = ticketInfo[j].userType;
                    }
                    if (ticketInfo[j].userType == "Online") {
                        userType = "Online User";
                    }

                    let winningPattern = ticketInfo[j]?.otherData?.winningStats;
                    //console.log("winningPattern", winningPattern);
                    if (winningPattern && winningPattern.length) {
                        if (ticketInfo[j].bonusWinningStats) {
                            if (ticketInfo[j].bonusWinningStats.wonAmount > 0) {
                                amount += +ticketInfo[j].bonusWinningStats.wonAmount;
                                // winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
                                winningPattern.forEach(pattern => {
                                    if (pattern.lineType == ticketInfo[j].bonusWinningStats.lineType) {
                                        pattern.wonAmount += +ticketInfo[j].bonusWinningStats.wonAmount;
                                    }
                                })
                            }
                        }

                        if (ticketInfo[j].luckyNumberWinningStats) {
                            if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
                                amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                // winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].luckyNumberWinningStats.lineType, wonAmount: ticketInfo[j].luckyNumberWinningStats.wonAmount })
                                winningPattern.forEach(pattern => {
                                    if (pattern.lineType == ticketInfo[j].luckyNumberWinningStats.lineType) {
                                        pattern.wonAmount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                    }
                                })
                            }
                        }
                    }

                    let wofWinners = "-";
                    if (ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0) {
                        wofWinners = ticketInfo[j].wofWinners.reduce((accum, item) => accum + item.WinningAmount, 0); //ticketInfo[j].wofWinners[0].WinningAmount;
                    }

                    let tChestWinners = "-";
                    if (ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0) {
                        tChestWinners = ticketInfo[j].tChestWinners.reduce((accum, item) => accum + item.WinningAmount, 0); //ticketInfo[j].tChestWinners[0].WinningAmount;
                    }

                    let mystryWinners = "-";
                    if (ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0) {
                        mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
                    }

                    let colorDraftWinners = "-";
                    if (ticketInfo[j].colorDraftWinners && ticketInfo[j].colorDraftWinners.length > 0) {
                        colorDraftWinners = ticketInfo[j].colorDraftWinners[0].WinningAmount;
                    }

                    if (ticketInfo[j].winningStats) {
                        ticketInfo[j].winningStats?.lineTypeArray?.forEach(type => {
                            if (type.isJackpotWon) {
                                winningPattern.forEach(data => {
                                    if (data.lineType == type.lineType) {
                                        data.isJackpotWon = true;
                                    }
                                })
                            }
                        })
                    }

                    // console.log("winning details :", j, " :", ticketInfo[j].winningStats, winningPattern);

                    let dataGame = {
                        _id: ticketInfo[j]._id,
                        playerNameOfPurchaser: ticketInfo[j].playerNameOfPurchaser,
                        UserType: userType,
                        startDate: data.startDate,
                        ticketId: ticketInfo[j].ticketId,
                        ticketPrice: ticketInfo[j].ticketPrice,
                        ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                        winnigPattern: winningPattern || [],
                        totalWinning: amount,
                        ticketColorType: ticketInfo[j].ticketColorName,
                        wofWinners: wofWinners,
                        tChestWinners: tChestWinners,
                        mystryWinners: mystryWinners,
                        hallName: ticketInfo[j].hallName,
                        groupHallName: ticketInfo[j].groupHallName,
                        colorDraftWinners: colorDraftWinners
                    }
                    gameData.push(dataGame);
                }
            }
            console.log("gameData---", gameData)
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketsCount,
                'recordsFiltered': ticketsCount,
                'data': gameData,
            };

            res.send(obj);

        } catch (e) {
            console.log("Error", e);
        }
    },

    // viewGameHistory: async function (req, res) {
    //     try {
    //         //console.log("viewGameHistory of schedule called", req.query, req.params)
    //         let sort = {};
    //         let start = parseInt(req.query.start);
    //         let length = parseInt(req.query.length);
    //         let search = req.query.search.value;

    //         let gameData = [];
    //         let query = {
    //             gameType: 'game_1',
    //             gameId: req.params.id,
    //             userType: ((req.query.userType).trim()),
    //             playerTicketType: "Online",
    //             isPhysicalTicket: false
    //         }
    //         let hallId = req.query.hall;
    //         let groupHallId = req.query.goh;
    //         if (hallId != "All") {
    //             query.hallId = hallId;
    //         }
    //         if (groupHallId != "All") {
    //             query.groupHallId = groupHallId;
    //         }

    //         if (req.session.details.role == "agent") {
    //             query.hallId = req.session.details.hall[0].id;
    //             delete query.groupHallId
    //         }

    //         if (search != '') {
    //             query.playerNameOfPurchaser = { $regex: `.*${search}.*`, $options: 'i' }
    //         }
    //         let data = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: req.params.id }, { subGames: 1, startDate: 1, status: 1 });
    //         if(data.status == "finish"){
    //             sort = {isPlayerWon: -1, totalWinningOfTicket: -1};
    //         }
    //         let ticketsCount = await Sys.App.Services.GameService.getTicketCount(query);
    //         let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);

    //         if (ticketInfo.length > 0) {
    //             for (let j = 0; j < ticketInfo.length; j++) {
    //                 let amount = 0;
    //                 if (ticketInfo[j].winningStats) {
    //                     amount = ticketInfo[j].winningStats.finalWonAmount;
    //                     winningLine = ticketInfo[j].winningStats.lineTypeArray;
    //                 }

    //                 let userType = "-";
    //                 if (ticketInfo[j].userType) {
    //                     userType = ticketInfo[j].userType;
    //                 }
    //                 if (ticketInfo[j].userType == "Online") {
    //                     userType = "Online User";
    //                 }
    //                 let winningPattern = ticketInfo[j].winningStats;
    //                 //console.log("winningPattern", winningPattern);
    //                 if (winningPattern) {
    //                     if (ticketInfo[j].bonusWinningStats) {
    //                         if (ticketInfo[j].bonusWinningStats.wonAmount > 0) {
    //                             amount += +ticketInfo[j].bonusWinningStats.wonAmount;
    //                             winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
    //                         }
    //                     }

    //                     if (ticketInfo[j].luckyNumberWinningStats) {
    //                         if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
    //                             amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
    //                             winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].luckyNumberWinningStats.lineType, wonAmount: ticketInfo[j].luckyNumberWinningStats.wonAmount })
    //                         }
    //                     }
    //                 }

    //                 let wofWinners = "-";
    //                 if (ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0) {
    //                     wofWinners = ticketInfo[j].wofWinners[0].WinningAmount;
    //                 }

    //                 let tChestWinners = "-";
    //                 if (ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0) {
    //                     tChestWinners = ticketInfo[j].tChestWinners[0].WinningAmount;
    //                 }

    //                 let mystryWinners = "-";
    //                 if (ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0) {
    //                     mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
    //                 }

    //                 let colorDraftWinners = "-";
    //                 if (ticketInfo[j].colorDraftWinners && ticketInfo[j].colorDraftWinners.length > 0) {
    //                     colorDraftWinners = ticketInfo[j].colorDraftWinners[0].WinningAmount;
    //                 }

    //                 let dataGame = {
    //                     _id: ticketInfo[j]._id,
    //                     playerNameOfPurchaser: ticketInfo[j].playerNameOfPurchaser,
    //                     UserType: userType,
    //                     startDate: data.startDate,
    //                     ticketId: ticketInfo[j].ticketId,
    //                     ticketPrice: ticketInfo[j].ticketPrice,
    //                     ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
    //                     winnigPattern: ticketInfo[j].winningStats,
    //                     totalWinning: amount,
    //                     ticketColorType: ticketInfo[j].ticketColorName,
    //                     wofWinners: wofWinners,
    //                     tChestWinners: tChestWinners,
    //                     mystryWinners: mystryWinners,
    //                     hallName: ticketInfo[j].hallName,
    //                     groupHallName: ticketInfo[j].groupHallName,
    //                     colorDraftWinners: colorDraftWinners
    //                 }
    //                 gameData.push(dataGame);
    //             }
    //         }
    //         console.log("gameData---", gameData)
    //         let obj = {
    //             'draw': req.query.draw,
    //             'recordsTotal': ticketsCount,
    //             'recordsFiltered': ticketsCount,
    //             'data': gameData,
    //         };

    //         res.send(obj);

    //     } catch (e) {
    //         console.log("Error", e);
    //     }
    // },


    viewPhysicalGameHistory: async function (req, res) {
        try {
            //console.log("viewPhysicalGameHistory of schedule called", req.query, req.params)
            let sort = { ticketId: 1 };
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let gameData = [];
            let query = {
                gameType: 'game_1',
                gameId: req.params.id,
                userType: "Physical",
                //playerTicketType: "Physical",
                //isPhysicalTicket: true
            }
            let hallId = req.query.hall;
            let groupHallId = req.query.goh;
            if (hallId != "All") {
                query.hallId = hallId;
            }
            if (groupHallId != "All") {
                query.groupHallId = groupHallId;
            }

            if (req.session.details.role == "agent") {
                query.hallId = req.session.details.hall[0].id;
                delete query.groupHallId
            }

            if (search != '') {
                // query.ticketColorName = { $regex: `.*${search}.*`, $options: 'i' }
                query.$or = [{ ticketColorName: { $regex: `.*${search}.*`, $options: 'i' } }, { ticketId: { $regex: `.*${search}.*`, $options: 'i' } }]
            }
            let data = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: req.params.id }, { subGames: 1, startDate: 1, status: 1 });
            if (data.status == "finish" || data.status == "running") {
                sort = { isPlayerWon: -1, totalWinningOfTicket: -1, ticketId: 1 };
            }
            let ticketsCount = await Sys.App.Services.GameService.getTicketCount(query);
            let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);
            //let ticketInfo = await Sys.App.Services.GameService.getTicketsByData(query, {}, { sort: sort, limit: length, skip: start });

            if (ticketInfo.length > 0) {
                for (let j = 0; j < ticketInfo.length; j++) {
                    let amount = 0;
                    if (ticketInfo[j]?.otherData?.winningStats) {
                        ticketInfo[j]?.otherData?.winningStats?.forEach(stats => {
                            amount += stats.wonAmount;
                        });
                    }

                    let userType = "-";
                    if (ticketInfo[j].userType) {
                        userType = ticketInfo[j].userType;
                    }
                    if (ticketInfo[j].userType == "Online") {
                        userType = "Online User";
                    }

                    userType = "Physical Ticket User";
                    let winningPattern = ticketInfo[j]?.otherData?.winningStats;
                    //console.log("winningPattern", winningPattern);
                    if (winningPattern && winningPattern.length) {
                        if (ticketInfo[j].bonusWinningStats) {
                            if (ticketInfo[j].bonusWinningStats.wonAmount > 0) {
                                amount += +ticketInfo[j].bonusWinningStats.wonAmount;
                                // winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
                                winningPattern.forEach(pattern => {
                                    if (pattern.lineType == ticketInfo[j].bonusWinningStats.lineType) {
                                        pattern.wonAmount += +ticketInfo[j].bonusWinningStats.wonAmount;
                                    }
                                })
                            }
                        }

                        if (ticketInfo[j].luckyNumberWinningStats) {
                            if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
                                amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                // winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].luckyNumberWinningStats.lineType, wonAmount: ticketInfo[j].luckyNumberWinningStats.wonAmount })
                                winningPattern.forEach(pattern => {
                                    if (pattern.lineType == ticketInfo[j].luckyNumberWinningStats.lineType) {
                                        pattern.wonAmount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                    }
                                })
                            }
                        }
                    }

                    let wofWinners = "-";
                    if (ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0) {
                        wofWinners = ticketInfo[j].wofWinners.reduce((accum, item) => accum + item.WinningAmount, 0); //ticketInfo[j].wofWinners[0].WinningAmount;
                    }

                    let tChestWinners = "-";
                    if (ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0) {
                        tChestWinners = ticketInfo[j].tChestWinners.reduce((accum, item) => accum + item.WinningAmount, 0); //ticketInfo[j].tChestWinners[0].WinningAmount;
                    }

                    let mystryWinners = "-";
                    if (ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0) {
                        mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
                    }

                    let colorDraftWinners = "-";
                    if (ticketInfo[j].colorDraftWinners && ticketInfo[j].colorDraftWinners.length > 0) {
                        colorDraftWinners = ticketInfo[j].colorDraftWinners[0].WinningAmount;
                    }

                    if (ticketInfo[j].winningStats) {
                        ticketInfo[j].winningStats?.lineTypeArray?.forEach(type => {
                            if (type.isJackpotWon) {
                                winningPattern.forEach(data => {
                                    if (data.lineType == type.lineType) {
                                        data.isJackpotWon = true;
                                    }
                                })
                            }
                        })
                    }

                    // console.log("winning details :", j, " :", ticketInfo[j].winningStats, winningPattern, amount);


                    let dataGame = {
                        _id: ticketInfo[j]._id,
                        playerIdOfPurchaser: ticketInfo[j].playerIdOfPurchaser,
                        UserType: userType,
                        startDate: data.startDate,
                        gameName: ticketInfo[j].gameName,
                        ticketId: ticketInfo[j].ticketId,
                        ticketPrice: ticketInfo[j].ticketPrice,
                        ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                        winnigPattern: winningPattern,
                        totalWinning: amount,
                        ticketColorType: ticketInfo[j].ticketColorName,
                        wofWinners: parseFloat(wofWinners),
                        tChestWinners: parseFloat(tChestWinners),
                        mystryWinners: parseFloat(mystryWinners),
                        hallName: ticketInfo[j].hallName,
                        groupHallName: ticketInfo[j].groupHallName,
                        colorDraftWinners: colorDraftWinners
                    }
                    gameData.push(dataGame);
                }
            }
            console.log("data data data ", gameData.length);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketsCount,
                'recordsFiltered': ticketsCount,
                'data': gameData,
            };
            return res.send(obj);

        } catch (e) {
            console.log("Error", e);
        }
    },

    // viewPhysicalGameHistory: async function (req, res) {
    //     try {
    //         //console.log("viewPhysicalGameHistory of schedule called", req.query, req.params)
    //         let sort = {ticketId: 1};
    //         let start = parseInt(req.query.start);
    //         let length = parseInt(req.query.length);
    //         let search = req.query.search.value;

    //         let gameData = [];
    //         let query = {
    //             gameType: 'game_1',
    //             gameId: req.params.id,
    //             // userType: "Unique",
    //             playerTicketType: "Physical",
    //             isPhysicalTicket: true
    //         }
    //         let hallId = req.query.hall;
    //         let groupHallId = req.query.goh;
    //         if (hallId != "All") {
    //             query.hallId = hallId;
    //         }
    //         if (groupHallId != "All") {
    //             query.groupHallId = groupHallId;
    //         }

    //         if (req.session.details.role == "agent") {
    //             query.hallId = req.session.details.hall[0].id;
    //             delete query.groupHallId
    //         }

    //         if (search != '') {
    //            // query.ticketColorName = { $regex: `.*${search}.*`, $options: 'i' }
    //            query.$or = [{ ticketColorName: { $regex: `.*${search}.*`, $options: 'i' } }, { ticketId: { $regex: `.*${search}.*`, $options: 'i' } }]
    //         }
    //         let data = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: req.params.id }, { subGames: 1, startDate: 1, status: 1 });
    //         if(data.status == "finish"){
    //             sort = {isPlayerWon: -1, totalWinningOfTicket: -1, ticketId: 1};
    //         }
    //         let ticketsCount = await Sys.App.Services.GameService.getTicketCount(query);
    //         //let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);
    //         let ticketInfo = await Sys.App.Services.GameService.getTicketsByData(query, {}, {sort: sort, limit:length, skip:start });

    //         if (ticketInfo.length > 0) {
    //             for (let j = 0; j < ticketInfo.length; j++) {
    //                 let amount = 0;
    //                 if (ticketInfo[j].winningStats) {
    //                     amount = ticketInfo[j].winningStats.finalWonAmount;
    //                     winningLine = ticketInfo[j].winningStats.lineTypeArray;
    //                 }

    //                 let userType = "-";
    //                 if (ticketInfo[j].userType) {
    //                     userType = ticketInfo[j].userType;
    //                 }
    //                 if (ticketInfo[j].userType == "Online") {
    //                     userType = "Online User";
    //                 }

    //                 userType = "Physical Ticket User";
    //                 let winningPattern = ticketInfo[j].winningStats;
    //                 //console.log("winningPattern", winningPattern);
    //                 if (winningPattern) {
    //                     if (ticketInfo[j].bonusWinningStats) {
    //                         if (ticketInfo[j].bonusWinningStats.wonAmount > 0) {
    //                             amount += +ticketInfo[j].bonusWinningStats.wonAmount;
    //                             winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
    //                         }
    //                     }

    //                     if (ticketInfo[j].luckyNumberWinningStats) {
    //                         if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
    //                             amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
    //                             winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].luckyNumberWinningStats.lineType, wonAmount: ticketInfo[j].luckyNumberWinningStats.wonAmount })
    //                         }
    //                     }
    //                 }

    //                 let wofWinners = 0;
    //                 if (ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0) {
    //                     wofWinners = ticketInfo[j].wofWinners.reduce((accum,item) => accum + item.WinningAmount, 0); //ticketInfo[j].wofWinners[0].WinningAmount;
    //                 }

    //                 let tChestWinners = 0;
    //                 if (ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0) {
    //                     tChestWinners = ticketInfo[j].tChestWinners.reduce((accum,item) => accum + item.WinningAmount, 0); //ticketInfo[j].tChestWinners[0].WinningAmount;
    //                 }

    //                 let mystryWinners = 0;
    //                 if (ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0) {
    //                     mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
    //                 }

    //                 let dataGame = {
    //                     _id: ticketInfo[j]._id,
    //                     playerIdOfPurchaser: ticketInfo[j].playerIdOfPurchaser,
    //                     UserType: userType,
    //                     startDate: data.startDate,
    //                     gameName: ticketInfo[j].gameName,
    //                     ticketId: ticketInfo[j].ticketId,
    //                     ticketPrice: ticketInfo[j].ticketPrice,
    //                     ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
    //                     winnigPattern: ticketInfo[j].winningStats,
    //                     totalWinning: amount,
    //                     ticketColorType: ticketInfo[j].ticketColorName,
    //                     wofWinners: parseFloat(wofWinners),
    //                     tChestWinners: parseFloat(tChestWinners),
    //                     mystryWinners: parseFloat(mystryWinners),
    //                     hallName: ticketInfo[j].hallName,
    //                     groupHallName: ticketInfo[j].groupHallName
    //                 }
    //                 gameData.push(dataGame);
    //             }
    //         }
    //         console.log("data data data ", gameData.length);
    //         let obj = {
    //             'draw': req.query.draw,
    //             'recordsTotal': ticketsCount,
    //             'recordsFiltered': ticketsCount,
    //             'data': gameData,
    //         };
    //         return res.send(obj);

    //     } catch (e) {
    //         console.log("Error", e);
    //     }
    // },

    addWinningManual: async function (req, res) {
        try {
            console.log("request data", req.body);

            let query = {
                _id: req.body.ticketId
            };
            let ticketData = await Sys.App.Services.GameService.getByIdTicket(query);
            console.log("Ticket Data Found", ticketData);

            if (ticketData) {
                if (ticketData.userType != "Physical") {
                    return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_can_only_payout_physical_user"], req.session.details.language) });
                }

                const gameStartDate = moment(ticketData.gameStartDate);
                const currentDate = moment();
                console.log("gameStartDate---", gameStartDate, currentDate);
                if (currentDate.isAfter(gameStartDate, 'day')) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_can_only_cash_out_the_same_day_game_player"], req.session.details.language) });
                }

                let winningPatterns = ticketData.winningStats?.lineTypeArray;
                console.log("winningPatterns---", winningPatterns)
                if (winningPatterns && winningPatterns.length > 0) {
                    let isFullHouse = winningPatterns.findIndex((e) => e.lineType == "Full House");
                    console.log("isFullHouse---", isFullHouse)
                    if (isFullHouse < 0) {
                        return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_can_not_cashout_wheel_of_fortune_prize_this_ticket_did_not_win_full_house"], req.session.details.language) });
                    }
                } else {
                    return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_can_not_cashout_wheel_of_fortune_prize_this_ticket_did_not_win_full_house"], req.session.details.language) });
                }

                if (req.body.type == "Wheel of Fortune") {
                    // await Sys.Game.Game1.Services.GameServices.updateTicket({ _id: ticketData._id, gameId: ticketData.gameId }, {
                    //     $push: {
                    //         "wofWinners": { WinningAmount: parseFloat(req.body.winning).toFixed(2) }
                    //     }, $inc: {
                    //         "winningStats.finalWonAmount": +parseFloat(req.body.winning).toFixed(2)
                    //     }
                    // });

                    // Sys.Game.Game1.Services.GameServices.updateTicket({_id: ticketData._id, gameId: ticketData.gameId }, 
                    //     { $push: { "wofWinners": {playerId: ticketData.playerIdOfPurchaser, WinningAmount: (Math.round(req.body.winning)), ticketId: ticketData._id} }, 
                    //         $inc: { totalWinningOfTicket: Math.round(req.body.winning), "winningStats.finalWonAmount": Math.round(req.body.winning) }  });
                    // Sys.Game.Game1.Services.GameServices.updateTicketNested({_id: ticketData._id}, {
                    //     $inc: {
                    //         'winningStats.lineTypeArray.$[current].wonAmount': Math.round(req.body.winning)
                    //     },
                    // }, { arrayFilters: [ {"current.lineType": "Full House"} ], new: true });



                    if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                        const hallId = req.session.details.hall[0].id;
                        const agentId = req.session.details.id;

                        let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, name: 1 });
                        if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                            isAgent = true;
                            if (hallsData.activeAgents[0].id != agentId) {
                                return res.send({
                                    status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["pls_ensure_privious_agent_logs_out_cashout"], req.session.details.language)
                                });
                            }

                            if (hallId != ticketData.hallId) {
                                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_can_only_cash_out_to_your_hall_physical_players"], req.session.details.language) });
                            }

                            let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                            let dailyBalance = hallsData.activeAgents[index].dailyBalance;
                            let amount = +req.body.winning;
                            if (amount <= 0) {
                                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["winning_amount_should_be_greater_then_zero"], req.session.details.language) });
                            }
                            if (dailyBalance < +amount) {
                                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["insufficient_daily_balance"], req.session.details.language) });
                            }

                            await Sys.Game.Game1.Services.GameServices.updateTicketNested({ _id: ticketData._id, gameId: ticketData.gameId },
                                {
                                    $push: { "wofWinners": { playerId: ticketData.playerIdOfPurchaser, WinningAmount: (Math.round(req.body.winning)), ticketId: ticketData._id } },
                                    $inc: {
                                        "totalWinningOfTicket": Math.round(req.body.winning),
                                        "winningStats.finalWonAmount": Math.round(req.body.winning),
                                        'winningStats.lineTypeArray.$[current].wonAmount': Math.round(req.body.winning),
                                        'otherData.winningStats.$[current].wonAmount': Math.round(req.body.winning),
                                    },
                                    $set: {
                                        'otherData.winningStats.$[current].isWinningDistributed': true
                                    }
                                }, { arrayFilters: [{ "current.lineType": "Full House" }], new: true });

                            await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: ticketData.gameId }, {
                                $inc: {
                                    'winners.$[current].wonAmount': +parseFloat(req.body.winning).toFixed(2),
                                    'wofWinners.$[current].WinningAmount': +parseFloat(req.body.winning).toFixed(2),
                                    'totalWinning': parseFloat(req.body.winning).toFixed(2),
                                    'finalGameProfitAmount': -parseFloat(req.body.winning).toFixed(2)
                                },
                            }, { arrayFilters: [{ "current.ticketId": ticketData.id, "current.lineType": "Full House" }], new: true });

                            await Sys.Helper.gameHelper.cashoutPhyscialTicketPatternbyPattern({
                                agentId: agentId,
                                agentName: req.session.details.name,
                                hallId: hallsData._id,
                                hallName: hallsData.name,
                                groupHall: hallsData.groupHall,
                                shiftId: req.session.details.shiftId,
                                totalAmount: +amount,
                                gameId: ticketData.gameId,
                                ticketNumber: ticketData.ticketNumber,
                                lineType: "Full House",
                                ticketId: ticketData._id,
                                ticketPrice: ticketData.ticketPrice
                                //typeOfTransaction: "Physical Ticket Winning Distribution"
                            });
                            req.session.details.dailyBalance = Number(req.session.details.dailyBalance) - (+amount);

                            return res.send({
                                "status": "success",
                                "message": await Sys.Helper.bingo.getSingleTraslateData(["winning_amount_add_successfully"], req.session.details.language),
                                "dailyBalance": req.session.details.dailyBalance
                            });

                        } else {
                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language) })
                        }
                    } else if (req.session.login && req.session.details.is_admin == 'yes' && req.session.details.role != "agent") {

                        let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: ticketData.hallId }, { activeAgents: 1, groupHall: 1, name: 1 });
                        if (hallsData) {
                            if (hallsData.activeAgents && hallsData.activeAgents.length > 0) {

                                let dailyBalance = hallsData.activeAgents[0].dailyBalance;
                                if (Math.round(req.body.winning) <= 0) {
                                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["winning_amount_should_be_greater_then_zero"], req.session.details.language) });
                                }
                                if (dailyBalance < Math.round(req.body.winning)) {
                                    return res.send({ status: "fail", message: `Agent "${hallsData.activeAgents[0].name}" don't have enough amount in daily balance` });
                                }
                                const transactionData = {
                                    agentId: hallsData.activeAgents[0].id,
                                    agentName: hallsData.activeAgents[0].name,
                                    shiftId: hallsData.activeAgents[0].shiftId,
                                    hallId: ticketData.hallId,
                                    typeOfTransaction: "Wheel of Fortune Prize",
                                    action: "debit",
                                    totalAmount: Math.round(req.body.winning),
                                    groupHallId: hallsData.groupHall.id,
                                    hall: {
                                        name: hallsData.name,
                                        id: hallsData._id.toString()
                                    },
                                    groupHall: {
                                        id: hallsData.groupHall.id.toString(),
                                        name: hallsData.groupHall.name
                                    },
                                    ticketData: { tickets: ticketData.tickets, gameId: ticketData.gameId, dailyScheduleId: ticketData.dailyScheduleId, playerIdOfPurchaser: ticketData.playerIdOfPurchaser, ticketColorType: ticketData.ticketColorType, ticketColorName: ticketData.ticketColorName, ticketPrice: ticketData.ticketPrice, userType: ticketData.userType, ticketPurchasedFrom: ticketData.ticketPurchasedFrom },
                                    userType: "Physical",
                                    paymentType: "Cash"
                                }
                                await Sys.Helper.gameHelper.physicalTicketTransactionsInHall(transactionData);


                                await Sys.Game.Game1.Services.GameServices.updateTicketNested({ _id: ticketData._id, gameId: ticketData.gameId },
                                    {
                                        $push: { "wofWinners": { playerId: ticketData.playerIdOfPurchaser, WinningAmount: (Math.round(req.body.winning)), ticketId: ticketData._id } },
                                        $inc: {
                                            "totalWinningOfTicket": Math.round(req.body.winning),
                                            "winningStats.finalWonAmount": Math.round(req.body.winning),
                                            'winningStats.lineTypeArray.$[current].wonAmount': Math.round(req.body.winning),
                                            'otherData.winningStats.$[current].wonAmount': Math.round(req.body.winning),
                                        },
                                        $set: {
                                            'otherData.winningStats.$[current].isWinningDistributed': true
                                        }
                                    }, { arrayFilters: [{ "current.lineType": "Full House" }], new: true });

                                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: ticketData.gameId }, {
                                    $inc: {
                                        'winners.$[current].wonAmount': +parseFloat(req.body.winning).toFixed(2),
                                        'wofWinners.$[current].WinningAmount': +parseFloat(req.body.winning).toFixed(2),
                                        'totalWinning': parseFloat(req.body.winning).toFixed(2),
                                        'finalGameProfitAmount': -parseFloat(req.body.winning).toFixed(2)
                                    },
                                }, { arrayFilters: [{ "current.ticketId": ticketData.id, "current.lineType": "Full House" }], new: true });

                                let transactionDataSend = {
                                    playerId: ticketData.playerIdOfPurchaser,
                                    playerName: ticketData.playerNameOfPurchaser,
                                    gameId: ticketData.gameId,
                                    transactionSlug: "WOFPrizeGame1",
                                    action: "debit", //"credit",
                                    purchasedSlug: "cash", //"realMoney",
                                    gameType: ticketData.gameType,
                                    patternPrize: +parseFloat(req.body.winning).toFixed(2),
                                    variantGame: ticketData.gameName,
                                    ticketPrice: ticketData.ticketPrice,
                                    ticketColorType: ticketData.ticketColorName,
                                    ticketNumber: ticketData.ticketNumber,
                                    ticketId: ticketData._id,
                                    game1Slug: "WOFPrizeGame1",
                                    typeOfTransaction: "Wheel of Fortune Prize",
                                    hallName: ticketData.hallName,
                                    userType: "Physical"
                                }
                                await Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend);
                                Sys.Helper.gameHelper.updateSession({ agentId: hallsData.activeAgents[0].id, hallId: ticketData.hallId, shiftId: hallsData.activeAgents[0].shiftId })
                                return res.send({
                                    "status": "success",
                                    "message": await Sys.Helper.bingo.getSingleTraslateData(["winning_amount_add_successfully"], req.session.details.language)
                                });

                            } else {
                                return res.send({ status: "fail", message: `Please ensure Agent is logged in to hall "${hallsData.name}"` })
                            }
                        } else {
                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language) })
                        }

                    } else {
                        return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["not_allowed_to_perform_action"], req.session.details.language) });
                    }


                    // await Sys.Game.Game1.Services.GameServices.updateGame({ _id: ticketData.gameId }, {
                    //     $inc: { totalWinning: +parseFloat(req.body.winning).toFixed(2), finalGameProfitAmount: - +parseFloat(req.body.winning).toFixed(2) }
                    // });

                    // Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: ticketData.gameId}, {
                    //     $inc: {
                    //         'winners.$[current].wonAmount': +parseFloat(req.body.winning).toFixed(2),
                    //         'wofWinners.$[current].WinningAmount': +parseFloat(req.body.winning).toFixed(2),
                    //     },
                    // }, { arrayFilters: [ {"current.ticketId": ticketData._id, "current.lineType": "Full House"} ], new: true });




                } else if (req.body.type == "Treasure Chest") {
                    return res.send({
                        "status": "fail",
                        "message": await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allow_to_add_winning_for_treasure_chest_game"], req.session.details.language)
                    });
                    // await Sys.Game.Game1.Services.GameServices.updateTicket({ _id: ticketData._id, gameId: ticketData.gameId }, {
                    //     $push: {
                    //         "tChestWinners": { WinningAmount: parseFloat(req.body.winning).toFixed(2) }
                    //     }, $inc: {
                    //         "winningStats.finalWonAmount": +parseFloat(req.body.winning).toFixed(2)
                    //     }
                    // });
                    Sys.Game.Game1.Services.GameServices.updateTicketNested({ _id: ticketData._id, gameId: ticketData.gameId },
                        {
                            $push: { "tChestWinners": { playerId: ticketData.playerIdOfPurchaser, WinningAmount: (Math.round(req.body.winning)), ticketId: ticketData._id } },
                            $inc: {
                                "totalWinningOfTicket": Math.round(req.body.winning),
                                "winningStats.finalWonAmount": Math.round(req.body.winning),
                                'winningStats.lineTypeArray.$[current].wonAmount': Math.round(req.body.winning)
                            }
                        }, { arrayFilters: [{ "current.lineType": "Full House" }], new: true });

                    let transactionDataSend = {
                        playerId: ticketData.playerIdOfPurchaser,
                        playerName: ticketData.playerNameOfPurchaser,
                        gameId: ticketData.gameId,
                        transactionSlug: "TChestPrizeGame1",
                        action: "debit", //"credit",
                        purchasedSlug: "cash", //"realMoney",
                        gameType: ticketData.gameType,
                        patternPrize: +parseFloat(req.body.winning).toFixed(2),
                        variantGame: ticketData.gameName,
                        ticketPrice: ticketData.ticketPrice,
                        ticketColorType: ticketData.ticketColorName,
                        ticketNumber: ticketData.ticketNumber,
                        ticketId: ticketData._id,
                        game1Slug: "TChestPrizeGame1",
                        typeOfTransaction: "Treasure Chest Prize",
                        hallName: ticketData.hallName,
                        userType: "Physical"
                    }

                    await Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend);

                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: ticketData.gameId }, {
                        $inc: {
                            'winners.$[current].wonAmount': +parseFloat(req.body.winning).toFixed(2),
                            'tChestWinners.$[current].WinningAmount': +parseFloat(req.body.winning).toFixed(2),
                            'totalWinning': parseFloat(req.body.winning).toFixed(2),
                            'finalGameProfitAmount': -parseFloat(req.body.winning).toFixed(2)
                        },
                    }, { arrayFilters: [{ "current.ticketId": ticketData.id, "current.lineType": "Full House" }], new: true });

                    return res.send({
                        "status": "success",
                        "message": "Winning Amount added Successfully!"
                    });
                }
            }
            return res.send({
                "status": "fail",
                "message": await Sys.Helper.bingo.getSingleTraslateData(["winning_amount_not_added"], req.session.details.language)
            });

        } catch (error) {
            console.log("Error in addWinningManual", error);
            return res.send({
                "status": "fail",
                "message": await Sys.Helper.bingo.getSingleTraslateData(["winning_amount_not_added"], req.session.details.language)
            })
        }
    },

    getAvailableGroupHallsBasedSlots: async function (req, res) {
        try {
            console.log("Dates getAvailableGroupHallsBasedSlots", req.query, req.params);
            let startDate = req.query.startDate;
            let endDate = req.query.endDate;
            let timeSlot = req.query.timeSlot;
            let startTime = "";
            let endTime = "";
            if (timeSlot) {
                let times = timeSlot.split('-');
                startTime = times[0].trim();
                endTime = times[1].trim()
            }
            if (req.params.type.length == 0) {
                return res.send({
                    "status": "fail",
                    "message": await Sys.Helper.bingo.getSingleTraslateData(["game_type_not_found"], req.session.details.language),
                    "groupHalls": []
                });
            }

            if (req.query.scheduleId && req.query.scheduleId != "") {
                let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.query.scheduleId }, {}, {});
                console.log("schedule", schedule)
                if (startDate !== '' && endDate !== '') { // || (startDate < schedule.startDate && endDate < schedule.startDate)
                    let stDate = new Date(startDate);
                    let scheduleStartDate = new Date(schedule.endDate);
                    let enDate = new Date(endDate);
                    let scheduleEndDate = new Date(schedule.endDate);
                    console.log("dates", startDate, scheduleStartDate, endDate)
                    if ((stDate > scheduleStartDate && enDate > scheduleEndDate)

                    ) {
                        console.log("in if")

                        let groupHalls = {};
                        if (startDate !== '' && endDate !== '') {
                            halls = await module.exports.findAvailableHallsBasedSlots(req.session.details, startDate, endDate, startTime, endTime);
                            console.log("available halls---", halls)
                            if (halls.status == "success") {
                                groupHalls = halls.groupHalls
                            }
                        }

                        return res.send({
                            "status": "success",
                            "groupHalls": groupHalls
                        });

                    } else {

                        console.log("in else")
                        let availHalls = await module.exports.findAvailableHallForEdit(req.query.scheduleId)
                        console.log("availHalls", availHalls)
                        if (availHalls.status == "success") {

                            let groupOfHallsTemp = availHalls.groupHalls.groupOfHalls;
                            let allHalls = availHalls.groupHalls.allHalls;
                            let groupOfHalls = [];
                            if (groupOfHallsTemp.length > 0) {
                                for (let g = 0; g < groupOfHallsTemp.length; g++) {
                                    groupOfHalls.push({
                                        _id: groupOfHallsTemp[g].id,
                                        name: groupOfHallsTemp[g].name,
                                        halls: groupOfHallsTemp[g].halls,
                                    })
                                }
                            }
                            return res.send({
                                "status": "success",
                                "groupHalls": { groupHallsAvailable: groupOfHalls, allHalls: allHalls }
                            });
                        }


                    }
                }
            } else {
                console.log("Else getAvailableGroupHallsBasedSlots");
                let groupHalls = {};
                console.log("endDate>>>", startDate, endDate);
                if (startDate && endDate) {
                    console.log("if ");
                    halls = await module.exports.findAvailableHallsBasedSlots(req.session.details, startDate, endDate, startTime, endTime);
                    console.log("available halls---", halls)
                    if (halls.status == "success") {
                        groupHalls = halls.groupHalls
                    }
                } else {
                    console.log("else");
                    if (startDate) {
                        halls = await module.exports.findAvailableHallsSpecialBasedSlots(req.session.details, startDate, endDate, startTime, endTime);
                        console.log("available halls---", halls)
                        if (halls.status == "success") {
                            groupHalls = halls.groupHalls
                        }
                    }
                }

                return res.send({
                    "status": "success",
                    "groupHalls": groupHalls
                });
            }


        } catch (e) {
            console.log("Error in getAvailable GroupHalls", e);
            return res.send({
                "status": "fail",
                "groupHalls": {}
            });
        }
    },

    findAvailableHallsBasedSlots: async function (user, startDate, endDate, startTime, endTime) {
        try {
            let data = [];
            let occupiedGroupOfHalls = [];
            let groupHallsAvailable = [];
            if (startDate !== '' && endDate !== '') {
                startDate = new Date(startDate);
                endDate = new Date(endDate);
                //Getting GroupHalls of all actvie and running games satisfying query condition
                let dataQuery = {
                    "status": { "$in": ['running', 'active'] },
                    "stopGame": false,
                    "startDate": { $lte: endDate },
                    "endDate": { $gte: startDate },
                    "isSavedGame": false
                    // "$or": [ 
                    //     { startDate: { $gte: startDate, $lte: endDate  } }, 
                    //     { endDate: { $gte: startDate, $lte: endDate  }  } 
                    // ]
                }

                if (user.role == 'agent') {
                    dataQuery['allHallsId'] = user.hall[0].id;
                }
                console.log("Query for date search", JSON.stringify(dataQuery));
                data = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {
                    _id: 0,
                    groupHalls: 1, startTime: 1, endTime: 1
                });
                console.log("data 1", data);

                let latestData = [];
                if (data.length > 0) {    //9 to 12   10 to 13  7 to 8:30
                    for (let i = 0; i < data.length; i++) {
                        if (startTime > data[i].endTime || (startTime < data[i].startTime && startTime < data[i].endTime && endTime < data[i].startTime)) {
                            //latestData.push(data[i]) 
                        } else {
                            latestData.push(data[i])
                        }
                    }
                }
                console.log("latestData--", latestData)
                data = latestData;

                if (data.length) {
                    let uniqueId = [];
                    for (let i = 0; i < data.length; i++) {
                        const element = data[i].groupHalls;
                        for (let j = 0; j < element.length; j++) {
                            uniqueId.push(element[j].id);
                            occupiedGroupOfHalls.push(element[j])
                        }
                    }
                    data = uniqueId.filter((v, i, a) => a.indexOf(v) === i);
                    let query = { _id: { "$nin": data }, status: "active" };
                    if (user.role == 'agent') {
                        query['halls.id'] = user.hall[0].id;
                    }
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData(query, { name: 1, halls: 1 });
                    //groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ "status":"active" }, { name: 1, halls: 1 });
                    //console.log("groupHallsAvailable", groupHallsAvailable);
                } else {
                    let query = {
                        "status": "active"
                    }
                    if (user.role == "agent") {
                        query['halls.id'] = user.hall[0].id;
                    }
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData(query, { name: 1, halls: 1 });
                }
            }
            //console.log("groupHallsAvailable", groupHallsAvailable)
            let allHalls = [];
            if (groupHallsAvailable.length > 0) {
                for (let i = 0; i < groupHallsAvailable.length; i++) {
                    console.log(groupHallsAvailable[i])
                    if (groupHallsAvailable[i].halls.length > 0) {
                        let groupHalls = []
                        for (let j = 0; j < groupHallsAvailable[i].halls.length; j++) {
                            if (groupHallsAvailable[i].halls[j].status == "active") {
                                groupHalls.push(groupHallsAvailable[i].halls[j])
                                allHalls.push(groupHallsAvailable[i].halls[j])
                            }
                        }
                        groupHallsAvailable[i].halls = groupHalls;
                    }

                }
            }

            //start occupiedGroupOfHalls
            //console.log("occupiedGroupOfHalls---", occupiedGroupOfHalls)
            const groupAndMerge = occupiedGroupOfHalls.reduce((ac, a) => {
                let temp = ac.find(x => x.id === a.id);
                if (!temp) ac.push({
                    ...a,
                    selectedHalls: [...a.selectedHalls]
                })
                else temp.selectedHalls.push(...a.selectedHalls)
                return ac;
            }, [])

            //console.log("grouped---",groupAndMerge);
            for (let g = 0; g < groupAndMerge.length; g++) {
                // console.log("halls", groupAndMerge[g].halls)
                let diff = groupAndMerge[g].halls.filter(o => !groupAndMerge[g].selectedHalls.some(v => v.id === o.id));
                //console.log("diff", diff)
                if (diff.length > 0) {
                    let isActive = false;
                    let groupOfActiveHalls = [];
                    for (d = 0; d < diff.length; d++) {
                        if (diff[d].status == "active") {
                            isActive = true;
                            allHalls.push(diff[d]);
                            groupOfActiveHalls.push(diff[d]);
                        }
                    }
                    if (isActive == true) {
                        groupHallsAvailable.push({ halls: groupOfActiveHalls, _id: groupAndMerge[g].id.toString(), name: groupAndMerge[g].name })
                    }
                }
            }
            //end  occupiedGroupOfHalls
            //console.log("available halls check conditions", {groupHallsAvailable: groupHallsAvailable, allHalls: allHalls })
            return {
                "status": "success",
                "groupHalls": { groupHallsAvailable: groupHallsAvailable, allHalls: allHalls }
            };
        } catch (e) {
            console.log(e);
            return {
                "status": "error",
                "groupHalls": {}
            };
        }
    },

    findAvailableHallsSpecialBasedSlots: async function (user, startDate, endDate, startTime, endTime) {
        try {
            let data = [];
            let occupiedGroupOfHalls = [];
            let groupHallsAvailable = [];
            if (startDate) {
                startDate = new Date(startDate);
                let endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 1);
                //Getting GroupHalls of all actvie and running games satisfying query condition
                let dataQuery = {
                    "status": { "$in": ['running', 'active'] },
                    "stopGame": false,
                    "startDate": { "$gte": startDate, "$lt": endDate },
                    "isSavedGame": false,
                    "specialGame": true
                }

                if (user.role == 'agent') {
                    dataQuery['allHallsId'] = user.hall[0].id;
                }
                console.log("Query for date search", dataQuery);
                data = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {
                    _id: 0,
                    groupHalls: 1, startTime: 1, endTime: 1
                });


                console.log("data 1", data);
                let latestData = [];
                if (data.length > 0) {    //9 to 12   10 to 13  7 to 8:30
                    for (let i = 0; i < data.length; i++) {
                        if (startTime > data[i].endTime || (startTime < data[i].startTime && startTime < data[i].endTime && endTime < data[i].startTime)) {
                            //latestData.push(data[i]) 
                        } else {
                            latestData.push(data[i])
                        }
                    }
                }
                console.log("latestData--", latestData)
                data = latestData;

                if (data.length) {
                    let uniqueId = [];
                    for (let i = 0; i < data.length; i++) {
                        const element = data[i].groupHalls;
                        for (let j = 0; j < element.length; j++) {
                            uniqueId.push(element[j].id);
                            occupiedGroupOfHalls.push(element[j])
                        }
                    }
                    data = uniqueId.filter((v, i, a) => a.indexOf(v) === i);
                    let query = { _id: { "$nin": data }, status: "active" };
                    if (user.role == 'agent') {
                        query['halls.id'] = user.hall[0].id;
                    }
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData(query, { name: 1, halls: 1 });
                    //groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData({ "status":"active" }, { name: 1, halls: 1 });
                    //console.log("groupHallsAvailable", groupHallsAvailable);
                } else {
                    let query = {
                        "status": "active"
                    }
                    if (user.role == "agent") {
                        query['halls.id'] = user.hall[0].id;
                    }
                    groupHallsAvailable = await Sys.App.Services.GroupHallServices.getByData(query, { name: 1, halls: 1 });
                }
            }
            //console.log("groupHallsAvailable", groupHallsAvailable)
            let allHalls = [];
            if (groupHallsAvailable.length > 0) {
                for (let i = 0; i < groupHallsAvailable.length; i++) {
                    console.log(groupHallsAvailable[i])
                    if (groupHallsAvailable[i].halls.length > 0) {
                        let groupHalls = []
                        for (let j = 0; j < groupHallsAvailable[i].halls.length; j++) {
                            if (groupHallsAvailable[i].halls[j].status == "active") {
                                groupHalls.push(groupHallsAvailable[i].halls[j])
                                allHalls.push(groupHallsAvailable[i].halls[j])
                            }
                        }
                        groupHallsAvailable[i].halls = groupHalls;
                    }

                }
            }

            //start occupiedGroupOfHalls
            //console.log("occupiedGroupOfHalls---", occupiedGroupOfHalls)
            const groupAndMerge = occupiedGroupOfHalls.reduce((ac, a) => {
                let temp = ac.find(x => x.id === a.id);
                if (!temp) ac.push({
                    ...a,
                    selectedHalls: [...a.selectedHalls]
                })
                else temp.selectedHalls.push(...a.selectedHalls)
                return ac;
            }, [])

            //console.log("grouped---",groupAndMerge);
            for (let g = 0; g < groupAndMerge.length; g++) {
                // console.log("halls", groupAndMerge[g].halls)
                let diff = groupAndMerge[g].halls.filter(o => !groupAndMerge[g].selectedHalls.some(v => v.id === o.id));
                //console.log("diff", diff)
                if (diff.length > 0) {
                    let isActive = false;
                    let groupOfActiveHalls = [];
                    for (d = 0; d < diff.length; d++) {
                        if (diff[d].status == "active") {
                            isActive = true;
                            allHalls.push(diff[d]);
                            groupOfActiveHalls.push(diff[d]);
                        }
                    }
                    if (isActive == true) {
                        groupHallsAvailable.push({ halls: groupOfActiveHalls, _id: groupAndMerge[g].id.toString(), name: groupAndMerge[g].name })
                    }
                }
            }
            //end  occupiedGroupOfHalls
            //console.log("available halls check conditions", {groupHallsAvailable: groupHallsAvailable, allHalls: allHalls })
            return {
                "status": "success",
                "groupHalls": { groupHallsAvailable: groupHallsAvailable, allHalls: allHalls }
            };
        } catch (e) {
            console.log(e);
            return {
                "status": "error",
                "groupHalls": {}
            };
        }
    },

    getSchedulesBySlot: async function (req, res) {
        try {
            let timeSlot = req.query.timeSlot;
            let startTime = "";
            let endTime = "";
            if (timeSlot) {
                let times = timeSlot.split('-');
                startTime = times[0].trim();
                endTime = times[1].trim()
            }
            let query = { manualStartTime: startTime, manualEndTime: endTime };
            if (req.session.details.role == "agent") {
                query['$or'] = [{ createrId: req.session.details.id }, { isAdminSchedule: true }];
            }
            let schedules = await Sys.App.Services.scheduleServices.getSchedulesByData(query, { scheduleName: 1 }, {});
            return res.send({
                "status": "success",
                "schedules": schedules
            });
        } catch (e) {
            console.log("Error in getAvailable GroupHalls", e);
            return res.send({
                "status": "fail",
                "schedules": []
            });
        }
    },

    findAvailableHallForEditBasedSlot: async function (scheduleId, agentData) {
        try {
            let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: scheduleId }, {}, {});

            let groupOfHallsIds = [];
            let groupOfHalls = [];
            let availableForSelectionMasterHals = [];
            let allHalls = [];
            if (schedule.groupHalls.length > 0) {
                for (let g = 0; g < schedule.groupHalls.length; g++) {
                    groupOfHallsIds.push(schedule.groupHalls[g].id);
                    groupOfHalls.push(schedule.groupHalls[g]);
                    if (schedule.groupHalls[g].selectedHalls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].selectedHalls.length; h++) {
                            availableForSelectionMasterHals.push(schedule.groupHalls[g].selectedHalls[h]);
                        }
                    }

                    if (schedule.groupHalls[g].halls.length > 0) {
                        for (let h = 0; h < schedule.groupHalls[g].halls.length; h++) {
                            allHalls.push(schedule.groupHalls[g].halls[h]);
                        }
                    }
                }
            }

            if (groupOfHalls.length > 0) {
                for (let h = 0; h < groupOfHalls.length; h++) {
                    let activeHalls = [];
                    for (let j = 0; j < groupOfHalls[h].halls.length; j++) {
                        if (groupOfHalls[h].halls[j].status == "active") {
                            activeHalls.push(groupOfHalls[h].halls[j])
                        }
                    }
                    groupOfHalls[h].halls = activeHalls;
                }
            }

            // start find other available group of halls
            let availableGroups = [];
            if (schedule.startDate !== '' && schedule.endDate !== '') {
                startDate = new Date(schedule.startDate);
                endDate = new Date(schedule.endDate);
                if (startDate !== '' && endDate !== '') {
                    let halls = await module.exports.findAvailableHallsBasedSlots(agentData, startDate, endDate, schedule.startTime, schedule.endTime);
                    //console.log("halls", halls)
                    if (halls.status == "success") {
                        availableGroups = halls.groupHalls.groupHallsAvailable
                    }
                }
            }
            //console.log("groupHallsAvailable", availableGroups, groupOfHalls)
            if (availableGroups.length > 0) {

                if (groupOfHalls.length > 0) {
                    for (let h = 0; h < groupOfHalls.length; h++) {
                        let index = availableGroups.findIndex(x => x._id == groupOfHalls[h].id);
                        if (index < 0) {
                            //console.log("not found hall, means fulled halls", groupOfHalls[h])
                            // this group's all halls are full,  so only consider already selected halls
                            groupOfHalls[h].halls = groupOfHalls[h].selectedHalls;
                        }
                    }
                }


                for (let i = 0; i < availableGroups.length; i++) {
                    let index = groupOfHalls.findIndex(x => x.id == availableGroups[i]._id.toString());
                    //console.log("index ", index, availableGroups[i]._id.toString())
                    if (index >= 0) {
                        console.log("groupOfHalls[index]", groupOfHalls[index].name, availableGroups[i].halls)
                        groupOfHalls[index].halls = availableGroups[i].halls
                        console.log("after replacing halls", groupOfHalls[index].name, groupOfHalls[index].halls, ...groupOfHalls[index].selectedHalls)
                        groupOfHalls[index].halls.push(...groupOfHalls[index].selectedHalls);
                        console.log("after replacing halls second", groupOfHalls[index].name, groupOfHalls[index].halls)
                        //allHalls.push(...availableGroups[i].halls)

                    } else {
                        //console.log("fresh halls, which are not used", availableGroups[i])
                        groupOfHalls.push({
                            id: availableGroups[i]._id.toString(),
                            name: availableGroups[i].name,
                            halls: availableGroups[i].halls,
                            isnotSelected: true,
                        });
                        groupOfHallsIds.push(availableGroups[i]._id.toString());

                        allHalls.push(...availableGroups[i].halls);

                    }
                }
            } else {
                allHalls = [];
                if (groupOfHalls.length > 0) {
                    for (let g = 0; g < groupOfHalls.length; g++) {
                        groupOfHalls[g].halls = groupOfHalls[g].selectedHalls;
                        allHalls.push(...groupOfHalls[g].selectedHalls)
                    }
                }
            }

            return {
                "status": "success",
                "groupHalls": { groupOfHallsIds: groupOfHallsIds, groupOfHalls: groupOfHalls, availableForSelectionMasterHals: availableForSelectionMasterHals, allHalls: allHalls }
            };
        } catch (e) {
            console.log(e);
            return {
                "status": "error",
                "findAvailableHallForEdit": {}
            };
        }
    },

    // refundCancelledGame: async function (data) {
    //     try {
    //         let games = await Sys.App.Services.GameService.getGamesByData({ _id: data.gameId }, { status: 1, stopGame: 1, ticketSold: 1, players: 1, gameNumber: 1, gameName: 1 }, {});
    //         console.log("games", games.length);
    //         if (games.length > 0) {
    //             for (let g = 0; g < games.length; g++) {
    //                 console.log("players when cancelling game", games[g].players)
    //                 Sys.Game.Common.Services.GameServices.updateGame({ _id: games[g]._id }, { $set: { status: 'finish', "otherData.gameSecondaryStatus": 'finish' } });
    //                 if (games[g].players.length > 0) {
    //                     for (let p = 0; p < games[g].players.length; p++) {
    //                         let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: games[g].players[p].id }, { username: 1 });
    //                         if (player) {
    //                             let tiketPrice = games[g].players[p].ticketPrice;
    //                             let ticketQty = games[g].players[p].totalPurchasedTickets;
    //                             let purchasedTickets = games[g].players[p].purchaseTicketTypes;
    //                             let purchasedSlug = games[g].players[p].purchasedSlug;

    //                             let updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
    //                                 { _id: games[g]._id, 'players.id': games[g].players[p].id },
    //                                 { $pull: { players: { id: games[g].players[p].id } }, $inc: { ticketSold: -ticketQty, earnedFromTickets: -tiketPrice, finalGameProfitAmount: -tiketPrice } },
    //                             );
    //                             console.log("updatedGame in cancelTicket of player", games[g].players[p].id, games[g]._id)

    //                             if (updateGame instanceof Error || updateGame == null || updateGame == undefined) {
    //                                 console.log("error in cancelling ticket when stopped game", games[g].players[p].id, games[g]._id);
    //                             } else {
    //                                 console.log("cancel ticket purchased, revert user amount while stopped game", games[g].players[p].id);

    //                                 if (purchasedSlug == "points") {
    //                                     await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: games[g].players[p].id }, { $inc: { points: tiketPrice } });
    //                                     let newExtraTransaction = {
    //                                         playerId: player._id,
    //                                         gameId: games[g]._id,
    //                                         transactionSlug: "extraTransaction",
    //                                         typeOfTransaction: "Refund",
    //                                         action: "credit", // debit / credit
    //                                         purchasedSlug: "points", // point /realMoney
    //                                         totalAmount: tiketPrice,
    //                                         game1Slug: "refund"
    //                                     }
    //                                     await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
    //                                 } else if (purchasedSlug == "realMoney") {
    //                                     await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: games[g].players[p].id }, { $inc: { walletAmount: tiketPrice, monthlyWalletAmountLimit: tiketPrice } });
    //                                     let newExtraTransaction = {
    //                                         playerId: player._id,
    //                                         gameId: games[g]._id,
    //                                         transactionSlug: "extraTransaction",
    //                                         typeOfTransaction: "Refund",
    //                                         action: "credit", // debit / credit
    //                                         purchasedSlug: "realMoney", // point /realMoney
    //                                         totalAmount: tiketPrice,
    //                                     }
    //                                     await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
    //                                 }

    //                                 if (purchasedTickets.length > 0) {
    //                                     let incObj = {};
    //                                     let filterArr = [];
    //                                     let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
    //                                     for (let s = 0; s < purchasedTickets.length; s++) {
    //                                         incObj["subGames.$[].options.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -(purchasedTickets[s].totalPurchasedTickets);
    //                                         filterArr.push({ [tempAlpha[s] + ".ticketName"]: purchasedTickets[s].ticketName })
    //                                     }
    //                                     Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: games[g]._id }, {
    //                                         $inc: incObj
    //                                     }, { arrayFilters: filterArr, new: true });
    //                                 }

    //                                 Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: games[g].players[p].id, gameId: games[g]._id });
    //                                 // update static tickets for predefined tickets flow
    //                                 Sys.Game.Game1.Services.GameServices.updateManyStaticData({ playerIdOfPurchaser: games[g].players[p].id, isPurchased: true, gameId: games[g]._id }, { isPurchased: false, playerIdOfPurchaser: "", gameId: "" });

    //                                 //let TimeMessage = games[g].gameNumber + " [ " + games[g].gameName + " ] Ticket Refund Successfully..!! ";
    //                                 let TimeMessage = {
    //                                     en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: games[g].gameNumber, number1: games[g].gameName }),
    //                                     nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: games[g].gameNumber, number1: games[g].gameName })
    //                                 };
    //                                 let notification = {
    //                                     notificationType: 'refundTickets',
    //                                     message: TimeMessage
    //                                 }

    //                                 let dataNotification = {
    //                                     playerId: player._id,
    //                                     gameId: games[g]._id,
    //                                     notification: notification
    //                                 }

    //                                 await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

    //                                 await Sys.Io.to(player.socketId).emit('NotificationBroadcast', {
    //                                     notificationType: notification.notificationType,
    //                                     message: TimeMessage
    //                                 });

    //                             }

    //                         }
    //                     }
    //                 }
    //                 Sys.Io.of(Sys.Config.Namespace.Game1).to(games[g]._id).emit('RefreshRoom', {});
    //                 Sys.Io.of(Sys.Config.Namespace.Game1).to(games[g]._id).emit('adminRefreshRoom', {});
    //                 //Remove balls mapping data of game
    //                 await Sys.Game.Game1.Services.GameServices.deleteManyBallMappingsByData({gameId: games[g]._id})
    //             }
    //         }
    //     } catch (e) {
    //         console.log("Error in refundStoppedSchedule", e)
    //     }
    // },

    refundCancelledGame: async function (data) {
        try {
            const games = await Sys.App.Services.GameService.getGamesByData(
                { _id: data.gameId },
                { status: 1, stopGame: 1, ticketSold: 1, players: 1, gameNumber: 1, gameName: 1 },
                {}
            );
    
            if (!games?.length) return;
    
            for (const game of games) {
                const gameId = game._id;
                const players = game.players || [];
    
                await Sys.Game.Common.Services.GameServices.updateGame(
                    { _id: gameId },
                    { $set: { status: 'finish', "otherData.gameSecondaryStatus": 'finish' } }
                );
    
                if (!players.length) continue;
    
                const playersData = await Promise.all(
                    players.map(p => Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: p.id }, { username: 1, socketId: 1 }))
                );
    
                for (let i = 0; i < players.length; i++) {
                    const player = playersData[i];
                    if (!player) continue;
    
                    const pData = players[i];
                    const { id: playerId, ticketPrice, totalPurchasedTickets, purchaseTicketTypes = [], purchasedSlug } = pData;
    
                    const updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                        { _id: gameId, 'players.id': playerId },
                        {
                            $pull: { players: { id: playerId } },
                            $inc: {
                                ticketSold: -totalPurchasedTickets,
                                earnedFromTickets: -ticketPrice,
                                finalGameProfitAmount: -ticketPrice
                            }
                        }
                    );
    
                    if (!updateGame || updateGame instanceof Error) {
                        console.log("Failed cancelling ticket for", playerId, gameId);
                        continue;
                    }
    
                    // Refund user
                    const refundUpdate = {
                        $inc: purchasedSlug === "points"
                            ? { points: ticketPrice }
                            : { walletAmount: ticketPrice, monthlyWalletAmountLimit: ticketPrice }
                    };
    
                    await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, refundUpdate);
    
                    const transactionData = {
                        playerId: player._id,
                        gameId,
                        transactionSlug: "extraTransaction",
                        typeOfTransaction: "Refund",
                        action: "credit",
                        purchasedSlug,
                        totalAmount: ticketPrice,
                        ...(purchasedSlug === "points" && { game1Slug: "refund" })
                    };
                    await Sys.Helper.gameHelper.createTransactionPlayer(transactionData);
                    let stopGamedata = {
                        playerId: playerId,
                        gameId: gameId,
                        gameName: game.gameName,
                        purchaseTicketTypes: purchaseTicketTypes,
                    }
                    await Sys.App.Controllers.agentcashinoutController.updateDailyTransactionByStopGame(stopGamedata);
                    // Refund subGame tickets if needed
                    if (purchaseTicketTypes.length) {
                        const incObj = {};
                        const arrayFilters = [];
                        const alpha = 'abcdefghijklmnopqrstuvwxyz';
    
                        for (let s = 0; s < purchaseTicketTypes.length; s++) {
                            const alias = alpha[s];
                            incObj[`subGames.$[].options.$[${alias}].totalPurchasedTickets`] = -purchaseTicketTypes[s].totalPurchasedTickets;
                            arrayFilters.push({ [`${alias}.ticketName`]: purchaseTicketTypes[s].ticketName });
                        }
    
                        await Sys.Game.Game1.Services.GameServices.updateGameNested(
                            { _id: gameId },
                            { $inc: incObj },
                            { arrayFilters, new: true }
                        );
                    }
    
                    // Clean up tickets
                    await Promise.all([
                        Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: playerId, gameId }),
                        Sys.Game.Game1.Services.GameServices.updateManyStaticData(
                            { playerIdOfPurchaser: playerId, isPurchased: true, gameId },
                            { isPurchased: false, playerIdOfPurchaser: "", gameId: "" }
                        )
                    ]);
    
                    // Send notification
                    const message = {
                        en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: game.gameNumber, number1: game.gameName }),
                        nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: game.gameNumber, number1: game.gameName })
                    };
    
                    const notification = {
                        notificationType: 'refundTickets',
                        message
                    };
    
                    const notifyPayload = {
                        playerId: player._id,
                        gameId,
                        notification
                    };
    
                    await Sys.Game.Common.Services.NotificationServices.create(notifyPayload);
    
                    if (player.socketId) {
                        Sys.Io.to(player.socketId).emit('NotificationBroadcast', {
                            notificationType: notification.notificationType,
                            message
                        });
                        Sys.Io.to(player.socketId).emit('PlayerHallLimit', { });
                    }
                }
    
                // Final cleanup for the game
                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                await Sys.Game.Game1.Services.GameServices.deleteManyBallMappingsByData({ gameId });
            }
        } catch (e) {
            console.error("Error in refundCancelledGame", e);
        }
    },    

    redirectToTVScreen: async function (req, res) {
        try {
            console.log("redirect id", req.params);
            if (req.params && req.params?.id) {
                if (req.session && req.session.details && req.session.details.is_admin == 'yes') {
                     const url = `${Sys.Config.App[Sys.Config.Database.connectionType].url}view-game/index.html?token=${req.params.id}${req.query.deviceType ? `&deviceType=${req.query.deviceType}` : ''}`;
                    return res.redirect(url);
                } else {
                    let groupOfHall = await Sys.App.Services.GroupHallServices.getSingleGoh({ tvId: req.params.id }, { tvId: 1, name: 1, halls: 1 });
                    console.log("groupOfHall---", groupOfHall);
                    if (groupOfHall) {
                        const url = `${Sys.Config.App[Sys.Config.Database.connectionType].url}view-game/index.html?token=${req.params.id}${req.query.deviceType ? `&deviceType=${req.query.deviceType}` : ''}`;
                        return res.redirect(url);
                        //const path = require("path");
                        //return res.sendFile(path.join(__dirname, '../../public', 'view-game/local/index.html'));

                        // let allHalls = [];
                        // if(groupOfHall.halls.length > 0){
                        //     for(let h=0; h < groupOfHall.halls.length; h++){
                        //         allHalls.push(groupOfHall.halls[h].id)
                        //     }
                        // }
                        // let query = {
                        //     gameType: "game_1",
                        //     halls: { $in: allHalls },
                        //     $or: [
                        //         { status: { $ne: "finish" } },
                        //         { 'otherData.gameSecondaryStatus': "running" }
                        //     ],
                        //     stopGame: false,
                        //     'otherData.isClosed': false,
                        //     startDate: {
                        //         $gte: moment().startOf('day').toDate(),
                        //         $lt: moment().startOf('day').add(2, 'day').toDate()
                        //     }
                        // }

                        // let games =  await Sys.Game.Game1.Services.GameServices.getByData(query, {gameName: 1, status: 1, otherData: 1, parentGameId: 1}, { sort: {startDate: 1} });
                        // let parentGameId = null;
                        // if(games.length > 0){

                        //     let status = {'running': 1,'active': 2};
                        //     games.sort((a, b) => status[a.status] - status[b.status]);

                        //     let index =  games.findIndex(x => (x.status == 'running' || x.otherData.gameSecondaryStatus == "running" ) );


                        //     if(index >= 0){
                        //         parentGameId = games[index].parentGameId;
                        //     }
                        //     if(parentGameId == null){
                        //         let upcomingIndex =  games.findIndex(x => x.status == 'active');
                        //         if(upcomingIndex >= 0){
                        //             if(moment(games[upcomingIndex].startDate).subtract(24, 'h') > moment() ){

                        //             }else{
                        //                 parentGameId = games[upcomingIndex].parentGameId;
                        //             }
                        //         }
                        //     }

                        // }

                        // if(parentGameId){

                        // }else{

                        // }

                    } else {
                        return res.render('404');
                    }
                }

            }
            return res.render('404');
        } catch (e) {
            console.log("Error in redirecting to TV Screen", e);
        }
    },

    // Not used it s required if we only need to show halls except maste rhall
    getScheduleHalls: async function (req, res) {
        try {
            const dailyScheduleId = req.query.dailyScheduleId;
            const schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: dailyScheduleId }, { groupHalls: 1, masterHall: 1 }, {});
            if (schedule) {
                const masterHalls = schedule.masterHall.id;
                let selectedHalls = schedule.groupHalls.flatMap(group => group.selectedHalls).filter(hall => hall.id !== masterHalls);
                return res.json({ status: "success", selectedHalls: selectedHalls });
            } else {
                return res.json({ status: "fail", message: await translate({ key: "something_went_wrong", language: req?.session?.details?.language }) });
            }
        } catch (e) {
            console.log("Error in getting halls", e);
            return res.json({ status: "fail", message: await translate({ key: "something_went_wrong", language: req?.session?.details?.language }) });
        }
    },

    saveSubGame: async function (req, res) {
        try {
            console.log("saveSubGame req.body:", req.body);
            console.log("saveSubGame req.body.subGame:", JSON.stringify(req.body.subGame, null, 2));
            let scheduleType = req.body.scheduleType;
            let subgames = [];
            if (req.body.subGame.length > 0) {
                for (const subGame of req.body.subGame) {
                    let ticketTypeObj = { ticketType: [], ticketPrice: [], ticketPrize: [], options: [] };
                    let ticketType = subGame.ticketColorType;
                    let ticketPrice = subGame.ticketColorTypePrice;
                    let ticketPrize = subGame.prize;
                    let minimumWinningPrize = {};
                    if (subGame.name == "Spillerness Spill" || subGame.name == "Spillerness Spill 2") {
                        minimumWinningPrize = subGame.minimumPrize;
                    }
                    console.log("ticketPrize", ticketPrize, minimumWinningPrize)
                    if (ticketType.length > 0) {
                        ticketTypeObj.ticketType = ticketType;
                        for (let t = 0; t < ticketType.length; t++) {
                            let priceTemp = (ticketPrice[0][ticketType[t]] != "" ? + ticketPrice[0][ticketType[t]] : 0)
                            if (subGame.name == "Traffic Light" || subGame.name == "Elvis") {
                                priceTemp = ticketPrice[0][ticketType[0]];
                            }
                            ticketTypeObj.ticketPrice.push({ name: ticketType[t], price: priceTemp })
                            ticketTypeObj.ticketPrize.push({ name: ticketType[t], prize: ticketPrize[ticketType[t].slice(6)], minimumPrize: minimumWinningPrize[ticketType[t].slice(6)] })
                            ticketTypeObj.options.push({ ticketName: ticketType[t], ticketPrice: priceTemp, winning: ticketPrize[ticketType[t].slice(6)], totalPurchasedTickets: 0, minimumWinning: minimumWinningPrize[ticketType[t].slice(6)] })
                        }
                    }

                    let jackpotPrize = 0;
                    let jackpotDraw = 0;
                    if (subGame.name == "Jackpot") {
                        //jackpotPrize = subGame.jackpotPrize;
                        jackpotPrize = {
                            'white': subGame.jackpotPrizeWhite,
                            'yellow': subGame.jackpotPrizeYellow,
                            'purple': subGame.jackpotPrizePurple
                        }
                        jackpotDraw = subGame.jackpotDraw;
                    }
                    let replaceTicketPrice = 0;
                    if (subGame.name == "Elvis") {
                        replaceTicketPrice = subGame.replace_price;
                    }
                    if (subGame.name == "Innsatsen") {
                        jackpotDraw = subGame.jackpotInnsatsenDraw;
                    }
                    subgames.push({
                        name: subGame.name,
                        custom_game_name: subGame.custom_game_name,
                        start_time: subGame.start_time,
                        end_time: subGame.end_time,
                        notificationStartTime: subGame.notificationStartTime,
                        minseconds: subGame.minseconds,
                        maxseconds: subGame.maxseconds,
                        seconds: subGame.seconds,
                        ticketTypesData: ticketTypeObj,
                        jackpotData: { jackpotPrize: jackpotPrize, jackpotDraw: jackpotDraw },
                        elvisData: { replaceTicketPrice: replaceTicketPrice }
                    })
                }
            }
            let data = {
                name: req.body.subGame[0].subGameName,
                type: 'single',
                scheduleType: scheduleType,
                subGames: subgames
            }
            const subGame = await Sys.App.Services.scheduleServices.insertSubGamesScheduleData(data);
            if (subGame) {
                return res.json({ status: "success", message: "Sub game saved successfully" });
            } else {
                return res.json({ status: "fail", message: "Sub game not found" });
            }
        } catch (e) {
            console.log("Error in saving sub game", e);
            return res.json({ status: "fail", message: "Something went wrong" });
        }
    },

    saveSubGames: async function (req, res) {
        try {
            console.log("saveSubGame req.body:", req.body);
            console.log("saveSubGame req.body.subGame:", JSON.stringify(req.body.subGame, null, 2));
            let scheduleType = req.body.scheduleType;
            let subGameName = req.body.subGameName;
            let subgames = [];
            if (req.body.subGame.length > 0) {
                for (const subGame of req.body.subGame) {
                    let ticketTypeObj = { ticketType: [], ticketPrice: [], ticketPrize: [], options: [] };
                    let ticketType = subGame.ticketColorType;
                    let ticketPrice = subGame.ticketColorTypePrice;
                    let ticketPrize = subGame.prize;
                    let minimumWinningPrize = {};
                    if (subGame.name == "Spillerness Spill" || subGame.name == "Spillerness Spill 2") {
                        minimumWinningPrize = subGame.minimumPrize;
                    }
                    console.log("ticketPrize", ticketPrize, minimumWinningPrize)
                    if (ticketType.length > 0) {
                        ticketTypeObj.ticketType = ticketType;
                        for (let t = 0; t < ticketType.length; t++) {
                            let priceTemp = (ticketPrice[0][ticketType[t]] != "" ? + ticketPrice[0][ticketType[t]] : 0)
                            if (subGame.name == "Traffic Light" || subGame.name == "Elvis") {
                                priceTemp = ticketPrice[0][ticketType[0]];
                            }
                            ticketTypeObj.ticketPrice.push({ name: ticketType[t], price: priceTemp })
                            ticketTypeObj.ticketPrize.push({ name: ticketType[t], prize: ticketPrize[ticketType[t].slice(6)], minimumPrize: minimumWinningPrize[ticketType[t].slice(6)] })
                            ticketTypeObj.options.push({ ticketName: ticketType[t], ticketPrice: priceTemp, winning: ticketPrize[ticketType[t].slice(6)], totalPurchasedTickets: 0, minimumWinning: minimumWinningPrize[ticketType[t].slice(6)] })
                        }
                    }

                    let jackpotPrize = 0;
                    let jackpotDraw = 0;
                    if (subGame.name == "Jackpot") {
                        //jackpotPrize = subGame.jackpotPrize;
                        jackpotPrize = {
                            'white': subGame.jackpotPrizeWhite,
                            'yellow': subGame.jackpotPrizeYellow,
                            'purple': subGame.jackpotPrizePurple
                        }
                        jackpotDraw = subGame.jackpotDraw;
                    }
                    let replaceTicketPrice = 0;
                    if (subGame.name == "Elvis") {
                        replaceTicketPrice = subGame.replace_price;
                    }
                    if (subGame.name == "Innsatsen") {
                        jackpotDraw = subGame.jackpotInnsatsenDraw;
                    }
                    subgames.push({
                        name: subGame.name,
                        start_time: subGame.start_time,
                        end_time: subGame.end_time,
                        notificationStartTime: subGame.notificationStartTime,
                        minseconds: subGame.minseconds,
                        maxseconds: subGame.maxseconds,
                        seconds: subGame.seconds,
                        ticketTypesData: ticketTypeObj,
                        jackpotData: { jackpotPrize: jackpotPrize, jackpotDraw: jackpotDraw },
                        elvisData: { replaceTicketPrice: replaceTicketPrice }
                    })
                }
            }
            let data = {
                name: subGameName,
                type: 'multiple',
                scheduleType: scheduleType,
                subGames: subgames
            }
            const subGame = await Sys.App.Services.scheduleServices.insertSubGamesScheduleData(data);
            if (subGame) {
                return res.json({ status: "success", message: "Sub game saved successfully" });
            } else {
                return res.json({ status: "fail", message: "Sub game not found" });
            }
        } catch (e) {
            console.log("Error in saving sub game", e);
            return res.json({ status: "fail", message: "Something went wrong" });
        }
    },

    getStoredSubGame: async function (req, res) {
        try {
            console.log("getStoredSubGame req.query:", req.query);
            const storedSubGames = await Sys.App.Services.scheduleServices.getStoredSubGames({type:"single"}, {_id:1, name:1}, {sort: {createdAt: -1}});
            if(storedSubGames){
                return res.json({ status: "success", data: storedSubGames });
            }else{
                return res.json({ status: "fail", message: "No stored sub games found" });
            }
        } catch (e) {
            console.log("Error in getting stored sub games", e);
            return res.json({ status: "fail", message: "Something went wrong" });
        }
    },

    getStoredSubGameData: async function (req, res) {
        try {
            const storedId = req.query.storedId;
            const storedSubGame = await Sys.App.Services.scheduleServices.getsubGamesScheduleData({ _id: storedId }, {}, {});
            if(storedSubGame){
                return res.json({ status: "success", data: {storedSubGame, subGameList: subGames} });
            }else{
                return res.json({ status: "fail", message: "No stored sub game found" });
            }
        } catch (e) {
            console.log("Error in getting stored sub game data", e);
            return res.json({ status: "fail", message: "Something went wrong" });
        }
    },

    getStoredSubGames: async function (req, res) {
        try {
            const storedSubGames = await Sys.App.Services.scheduleServices.getStoredSubGames({type:"multiple"}, {_id:1, name:1}, {sort: {createdAt: -1}});
            if(storedSubGames){
                return res.json({ status: "success", data: storedSubGames });
            }else{
                return res.json({ status: "fail", message: "No stored sub games found" });
            }
        } catch (e) {
            console.log("Error in getting stored sub games", e);
            return res.json({ status: "fail", message: "Something went wrong" });
        }
    },

    getStoredSubGamesData: async function (req, res) {
        try {
            const storedId = req.query.storedId;
            const storedSubGame = await Sys.App.Services.scheduleServices.getsubGamesScheduleData({ _id: storedId }, {}, {});
            if(storedSubGame){
                return res.json({ status: "success", data: {storedSubGame, subGameList: subGames} });
            }else{
                return res.json({ status: "fail", message: "No stored sub game found" });
            }
        } catch (e) {
            console.log("Error in getting stored sub game data", e);
            return res.json({ status: "fail", message: "Something went wrong" });
        }
    },

    checkStoreSubGameName: async function (req, res) {
        try {
            console.log("checkStoreSubGameName req.query:", req.query, req?.session?.details?.language);
            let {type, scheduleType, name} = req.query;
            const storedSubGames = await Sys.App.Services.scheduleServices.getsubGamesScheduleData({type, scheduleType, name}, {_id:1, name:1});
            if(storedSubGames){
                // let message = await translate({ key: "sub_game_name_is_already_exists", language: req?.session?.details?.language });
                let message = await Sys.Helper.bingo.getSingleTraslateData(["sub_game_name_is_already_exists"], req.session.details.language)
                return res.json({ status: "fail", message});
            }else{
                return res.json({ status: "success"});
            }
        } catch (e) {
            console.log("Error in checking stored sub game name", e);
            return res.json({ status: "fail", message: await translate({ key: "something_went_wrong", language: req?.session?.details?.language }) });
        }
    },
}

function parseTime(time) {
    const [hours, minutes] = time.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
}


function dateTimeFunction(dateData) {
    let dt = new Date(dateData);
    let date = dt.getDate();
    let month = parseInt(dt.getMonth() + 1);
    let year = dt.getFullYear();
    let hours = dt.getHours();
    let minutes = dt.getMinutes();
    let seconds = dt.getSeconds();
    let miliSeconds = dt.getMilliseconds();
    let ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;
    let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + seconds + miliSeconds;
    return dateTime; // Function returns the dateandtime
}

function translateSubGames(subGames, lang) {
    return subGames.map(game => ({
        gameName: game.gameName, // gameName remains static
        ticketType: game.ticketType.map(key => translations[lang][key] || key),
        WinningPatterns: game.WinningPatterns.map(key => translations[lang][key] || key)
    }));
}
