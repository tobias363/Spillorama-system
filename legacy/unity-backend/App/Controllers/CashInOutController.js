var Sys = require('../../Boot/Sys');
const redisClient = require('../../Config/Redis');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');
const { func } = require('joi');
var ETICKETCOLORS = [
    'Small White', 'Large White', 'Small Yellow', 'Large Yellow', 'Small Purple',
    'Large Purple', 'Small Blue', 'Large Blue'
];
var dateFormat = require('dateformat');
module.exports = {
    cashInOutPage: async function (req, res) {
        let keys = [
            "cash_in_out_management",
            "back",
            "shift_logout",
            "default",
            "agent_module",
            "game_module",
            "agent_name",
            "title_cashin",
            "amount",
            "total_hall_cash_balance",
            "total_cash_in",
            "total_cash_out",
            "daily_balance",
            "add_daily_balance",
            "refresh_table",
            "control_daily_balance",
            "todays_sales_report",
            "settlement",
            "cash_in_out",
            "add_money",
            "unique_id",
            "registered_user",
            "create",
            "new_unique_id",
            "withdraw",
            "sell",
            "products",
            "next_game",
            "bingo_game1",
            "hall_status",
            "register_more_tickets",
            "register_sold_tickets",
            "tv_screen",
            "upcoming_game",
            "start_next_game",
            "countdown_time",
            "minutes",
            "update_timer",
            "transfer_hall_access",
            "submit",
            "are_you_ready",
            "SOLD_TICKETS_OF_EACH_TYPE",
            "my_halls",
            "physical",
            "terminal",
            "web",
            "group_of_Halls",
            "total_number_of_ticket",
            "PAUSE_Game_and_check_for_Bingo",
            "RESUME_game",
            "are_you_eady",
            "check_for_bingo",
            "see_all_drawn_numbers",
            "winning_my_hall_this_game",
            "winnings_group_of_hall",
            "no_ongoing_games_available",
            "completed_games_in_hall",
            "sub_game_id",
            "sub_game_name",
            "start_time",
            "action",
            "current_balance",
            "enter_balance",
            "add",
            "cancel",
            "are_you_sure_you_want_to_log_out",
            "distribute_winnings_to_all_physical_players",
            "do_you_want_to_transfer_the_registered_tickets_to_next_agent",
            "view_cashout_details",
            "yes",
            "bingo_numbers",
            "enter_ticket_number",
            "go",
            "bingo_pattern",
            "halls_info",
            "ready_to_go",
            "not_ready_yet",
            "all_winners",
            "physical_ticket_no",
            "ticket_type",
            "ticket_price",
            "winning_pattern",
            "total_winning",
            "rewarded_amount",
            "pending_amount",
            "difference_daily_balance",
            "daily_balance_at_start_of_shift",
            "daily_balance_at_end_of_shift",
            "from_start_to_end_of_shift",
            "settlement_to_drop_safe",
            "withdraw_from_total_balance",
            "total_dropsafe",
            "ticket",
            "draw",
            "ready_to_go",
            "are_you_ready",
            "are_you_sure",
            "do_you_want_to_stop_the_game",
            "delete_button",
            "failed",
            "theres_no_ongoing_game_to_stop_at_the_moment",
            "do_you_want_to",
            "the_game",
            "game_is_already_running",
            "theres_no_game_available_to_resume",
            "no_patterns_won",
            "do_you_want_to_cash_out",
            "do_you_want_to_add_to_wallet",
            "do_you_want_to_transfer_hall_access",
            "accept",
            "reject",
            "success",
            "error",
            "no_upcoming_games_available",
            "please_confirm_the_jackpot_prize_and_draw_to_start_the_game",
            "jackpot_prize_and_draws",
            "please_confirm_the_jackpot_draw_to_start_the_game",
            "jackpot_draw",
            "confirm",
            "cancel",
            "ongoing_game",
            "register_more_physical_tickets",
            "initial_id_of_the_stack",
            "data_updated_successfully",
            "Something_went_wrong",
            "registered_tickets",
            "ticket_type",
            "initial_id",
            "final_id",
            "tickets_sold",
            "action",
            "register_more_tickets_edit",
            "scan",
            "edit",
            "register_sold_tickets",
            "final_id_of_the_stack",
            "submit",
            "cancel",
            "upcoming_games",
            "sub_game_id",
            "sub_game_name",
            "start_time",
            "ticket_color_type",
            "ticket_price",
            "total_number_of_tickets_sold",
            "Total_earned_from",
            "status",
            "enter_unique_id",
            "amount",
            "select_payment_type",
            "cash",
            "card",
            "enter_username_customer_number",
            "enter_username_customer_number_phone_number",
            "add_money_register_user",
            "dashboard",
            "withdraw_money_register_user",
            "add_money",
            "withdraw_money",
            "do_you_want_to_add_money_to_username",
            "yes_add_money",
            "the_add_money_action_has_been_cancelled",
            "do_you_want_to_withdraw_money_from_username",
            "yes_withdraw_money",
            "the_withdraw_money_action_has_been_cancelled",
            "are_you_sure",
            "success",
            "failed",
            "cancelled",
            "add_money_unique_id",
            "withdraw_money_unique_id",
            "add_money_unique_d",
            "withdraw_money_register_user",
            "sure_want_to_delete_physical_ticket",
            "not_be_able_to_recover_physical_ticket",
            "physical_ticket_deleted_success",
            "physical_ticket_not_deleted",
            "deleted",
            "cancel_button",
            "registering_non_seq_id",
            "erro_fetching_balance",
            "sure_want_to_remove_all_physical_ticket",
            "search_by_game_name",
            "previous",
            "next",
            "alert",
            "sure_want_to_stop_game",
            "stop",
            "resume",
            "sure_resume_game",
            "search",
            "do_you_want_to_master_hall",
            "machine_id",
            "total_cash_balance",
            "enter",
            "fullname",
            "customer_number",
            "username",
            "phone_number",
            "jackpot_prize_of_yellow_ticket",
            "jackpot_prize_of_white_ticket",
            "jackpot_prize_of_purple_ticket",
            "draw",
            "no",
            "slot_machine",
            "select_slot_machine",
            "make_ticket",
            "add_to_ticket",
            "balance_on_ticket",
            "close_ticket",
            "player_account",
            "enter_ticketId",
            "open_day",
            "close_day",
            "get_numbers_today_this_far",
            "close_all_tickets",
            "todays_number_this_far",
            "ticket_info",
            "balance",
            "ticket_status",
            "print_details",
            "ticket_details",
            "ticket_number",
            "in_amount",
            "out_amount",
            "operation_completed_but_tickets_are_open",
            "open_tickets",
            "select_make_or_add_ticket",
            "machine_name",
            "decimal_not_allowed",
            "minute",
            "amount_should_be_between_1_1000",
            "enter_wof_wining_prize",
            "wof_prize",
            "total_deposits",
            "total_withdrawals",
            "total_ticket_purchases",
            "total",
            "profit",
            "loss",
            "view_game",
            "stop_game",
            "stop_game_options",
            "stop_game_without_refund",
            "stop_game_and_refund_all_halls",
            "stop_game_and_refund",
            "stop_game_hall",
            "select_hall_to_stop_game_in_hall",
            "select_hall",
            "are_you_sure_you_want_to_stop_game_without_refund",
            "are_you_sure_you_want_to_stop_game_and_refund_all_halls",
            "are_you_sure_you_want_to_stop_game_in_hall",
            "please_select_a_hall",
            "pause_Game_without_announcement",
            "no_patterns_won",
            "missed_winnings_claims",
            "last_matched_ball",
            "draw_count_when_pattern_missed",
            "total_draw_count",
            "rewarded",
            "cash_out",
            "add_to_wallet",
            "processing",
            "second_to_display_single_ball",
            "do_you_want_to_update_second_to_display_single_ball",
            "testing_game",
            "please_select_seconds",
            "ticket_not_valid_or_not_sold",
            "draw_number",
            "draw_count",
            "showing",
            "entries",
            "no_unclaimed_winnings_found",
            "remaining_daily_limit",
            "remaining_monthly_limit",
            "bilag",
            "other",
            "profit_transfer_to_bank",
            "difference_on_shift",
            "merknad"
        ]

        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {
            let tvId = null;
            if (req.session && req.session.login == true && req.session.details?.hall.length > 0) {
                let groupOfHall = await Sys.App.Services.GroupHallServices.getSingleGoh({ halls: { $elemMatch: { id: req.session.details?.hall[0].id } } }, { tvId: 1 });
                if (groupOfHall) {
                    tvId = groupOfHall.tvId;
                }
            }
            const escapedMessages = JSON.stringify(translate)
                
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cashinoutActive: 'active',
                cashinoutManagement: 'active',
                tvId: tvId,
                translate: translate,
                navigation: translate,
                translate_stringified: escapedMessages,
                current_language: req.session.details.language
            };
            return res.render('cash-inout/cash_in-out.html', data);
        } catch (e) {
            console.log("Error while rendering cash in out page", e);
            return res.redirect('admin/dashboard');
        }
    },

    soldTickets: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Physical Ticket Management'] || [];
                let stringReplace =req.session.details.isPermission['Physical Ticket Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }

                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            const keys = [
                "sold_tickets",
                "dashboard",
                "sold_ticket",
                "from_date",
                "to_date",
                "ticket_type",
                "web",
                "terminal",
                "physical",
                "search",
                "date_time",
                "player_name",
                "group_of_hall",
                "hall_name",
                "ticket_color_type",
                "ticket_number",
                "ticket_price",
                "winnig_pattern",
                "total_winning",
                "spin_wheel_winning",
                "treasure_chest_winning",
                "mystery_winning",
                "color_draft_winning",
                "action",
                "winning_information",
                "previous",
                "next",
                "pattern_name",
                "balls_drawn",
                "won_on_number",
                "winning_numbers",
                "no_winners_found",
                "winning_amount"
            ];


            let soldTicket = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                soldTicketManagement: 'active',
                cashinoutManagement: 'active',
                soldTicket: soldTicket,
                navigation: soldTicket
            };
            return res.render('cash-inout/sold-tickets.html', data);
        } catch (e) {
            console.log("Error while rendering cash in out page", e);
            return res.redirect('admin/dashboard');
        }
    },

    getSoldTickets: async function (req, res) {
        try {
            let sort = { createdAt: -1 };
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let gameData = [];
            let query = {
                gameType: 'game_1',
            }

            if (req.query.ticketType) {
                query.userTicketType = req.query.ticketType;
            }

            let fromDate = req.query.start_date;
            let toDate = req.query.end_date;

            if (fromDate) {
                let startOfToday = new Date(fromDate);
                startOfToday.setHours(0, 0, 0, 0);
                query['createdAt'] = { $gte: startOfToday };
            }
            if (toDate) {
                let endDate = new Date(toDate);
                endDate.setHours(23, 59, 59, 999);
                if (query['createdAt']) {
                    query['createdAt']['$lt'] = endDate;
                } else {
                    query['createdAt'] = { $lt: endDate };
                }
            }

            if (req.session.details.role == "agent") {
                query.hallId = req.session.details.hall[0].id;
            }

            if (search != '') {
                query.ticketId = { $regex: `.*${search}.*`, $options: 'i' }
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

                    let dataGame = {
                        _id: ticketInfo[j]._id,
                        playerNameOfPurchaser: ticketInfo[j].playerNameOfPurchaser,
                        UserType: ticketInfo[j].userTicketType,
                        createdAt: ticketInfo[j].createdAt,
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
                        colorDraftWinners: colorDraftWinners,
                        ticket: ticketInfo[j].tickets
                    }
                    gameData.push(dataGame);
                }
            }

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

}