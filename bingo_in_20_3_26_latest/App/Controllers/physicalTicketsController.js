const Sys = require('../../Boot/Sys');
const moment = require('moment');
const { default: mongoose } = require('mongoose');
module.exports = {
    addPhysicalTickets: async function (req, res) {
        try {
            let viewFlag = true;
            let addFlag = true;
            let allHalls = [];
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
                // let stringReplace = req.session.details.isPermission['Physical Ticket Management'];
                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("add") == -1) {
                    addFlag = false;
                }
                if(req.session.details.hall && req.session.details.hall.length > 0){
                    allHalls = req.session.details.hall;
                }else if(req.session.details.role == "admin"){
                    allHalls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "status": "active" }, { name: 1 });
                }
            } else {
                allHalls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "status": "active" }, { name: 1 });
            }
            //console.log("allHalls---", allHalls)

            // remove old Yesterday physical ticket, Now no need to remove as per client new requirement
            // const startOfToday = moment().startOf('day').toDate();
            // await Sys.App.Services.scheduleServices.deleteManyAgentRegisteredTicket({
            //     createdAt: {
            //         $lt: startOfToday
            //     }
            // });

            let keyData = [
                "data_update_successfully",
                "add_physical_tickets",
                "select_hall",
                "initail_id_of_the_stack",
                "scan",
                "submit",
                "registered_tickets",
                "register_more_tickets_edit",
                "initial_id_of_the_stack",
                "ticket_type",
                "initial_id",
                "final_id",
                "tickets_sold",
                "action",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "sure_want_to_delete_physical_ticket",
                "not_be_able_to_recover_physical_ticket",
                "delete_button",
                "cancel_button",
                "physical_ticket_deleted_success",
                "physical_ticket_not_deleted",
                "deleted",
                "cancelled",
                "erro_fetching_balance",
                "edit",
                "select_hall_name"
            ]

            let physical = await Sys.Helper.bingo.getTraslateData(keyData, req.session.details.language)


            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                addPhysicalTicketsActive: 'active',
                allHalls: allHalls,
                physical: physical,
                navigation: physical
            };

            // check if this is the active agent for the hall
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                hallId = req.session.details.hall[0].id;
                let agentId = req.session.details.id;
                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, hallCashBalance: 1, otherData: 1 });
                const currentActiveAgent = hallsData?.activeAgents?.find(agent => agent.id === agentId);
                if (!hallsData.activeAgents || hallsData.activeAgents.length == 0 || !currentActiveAgent ) { // hallDetails.activeAgents[0].id != createrId
                    req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["please_ensure_the_previous_agent_logs_out_before_registering_the_tickets"], req.session.details.language)) //'Please ensure the previous agent logs out before Registering the tickets.');
                    return res.redirect('/dashboard');
                }
            }


            if (viewFlag == true && addFlag == true) {
                return res.render('physicalTickets/add', data);
            } else {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)) //'You are Not allowed to access that page.');
                res.redirect('/dashboard');
            }

        } catch (error) {
            Sys.Log.error('Error in addPhysicalTickets: ', error);
            return new Error(error);
        }
    },

    /*addPhysicalTicketsPost: async function(req, res) {
        try {
            console.log("req.query", req.body, req.params, req.session.details)
            let initialId = req.body.initialId;
            let finalId = req.body.finalId;
            if(!initialId && !finalId){
                res.send({status: "fail", message: "Please provide ticket Id's."});
            }
            if(+initialId > +finalId){
                res.send({status: "fail", message: "Final Id Should be greater than Initial Id."});
            }
            if(req.session.details && req.session.details.is_admin == "no" && req.session.details.id){
                let agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: req.session.details.id }, ['hall', 'registeredTickets']);
                let agentHall = req.session.details.hall[0].name;
                console.log("agentDetails---", agentDetails, agentHall);
                if(agentDetails && agentHall){
                    let ticketIdArray = [];
                    for(let i= +initialId; i <= +finalId; i++){
                        ticketIdArray.push(i.toString());
                    }
                    let ticketCount = ticketIdArray.length;
                    console.log("all ticketIds", ticketIdArray, ticketCount);

                    let ticketColorData = await Sys.App.Services.GameService.getSingleStaticPhysicalTicketsByData({ ticketId: initialId }, {ticketColor: 1, ticketType: 1});
                    console.log("ticketColor---", ticketColorData);
                    if(ticketColorData){
                        //let traficLightColors = ['Small Red', 'Small Yellow', 'Small Green'];
                        //let count =0;
                        if(ticketColorData.ticketType == "traffic-light"){ //if(traficLightColors.includes(ticketColorData.ticketColor) == true ){
                            //count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ ticketId: {$in: ticketIdArray}, hallName: agentHall, ticketType: "traffic-light" });
                            count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ $and: [{ $expr: { $gte: [{ $toDouble: "$ticketId" }, +initialId] } },{ $expr: { $lte: [{ $toDouble: "$ticketId" }, +finalId] } }], hallName: agentHall, ticketType: "traffic-light" });
                        }else{
                            count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ $and: [{ $expr: { $gte: [{ $toDouble: "$ticketId" }, +initialId] } },{ $expr: { $lte: [{ $toDouble: "$ticketId" }, +finalId] } }] , hallName: agentHall, ticketColor: ticketColorData.ticketColor });
                        }
                        console.log("count--", count, { hallName: agentHall,  ticketColor: ticketColorData.ticketColor })
                        if(ticketCount == count){
                            // add this range of tickets
                            if(agentDetails.registeredTickets.length == 0) {
                                let registeredTickets = {
                                    hallName: req.session.details.hall[0].name,
                                    hallId: req.session.details.hall[0].id,
                                    allRange: [
                                        {
                                            id: (+new Date()).toString(),
                                            ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                            initialId: initialId,
                                            finalId: finalId,
                                            ticketsAvailableFrom: initialId,
                                            ticketIds: ticketIdArray,
                                            lastUpdatedDate: new Date(),
                                            isTicketsInTrack: true,
                                        }
                                    ]
                                }
                                await Sys.App.Services.AgentServices.FindOneUpdate({ _id: agentDetails._id }, { registeredTickets: registeredTickets });
                            }else{
                                const isAdded = agentDetails.registeredTickets.findIndex((e) => e.hallId == req.session.details.hall[0].id);
                                if(isAdded != -1){
                                    let rangeData = {
                                        id: (+new Date()).toString(),
                                        ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                        initialId: initialId,
                                        finalId: finalId,
                                        ticketsAvailableFrom: initialId,
                                        ticketIds: ticketIdArray,
                                        lastUpdatedDate: new Date()
                                    }
                                    console.log(" agentDetails.registeredTickets[isAdded].allRange",  agentDetails.registeredTickets[isAdded]);
                                    let searchTicketColor = (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor;
                                    console.log("searchTicketColor---", searchTicketColor)
                                    let isColor = agentDetails.registeredTickets[isAdded].allRange.findIndex((e) => e.ticketColor == searchTicketColor );
                                    console.log("isColor--", isColor)
                                    if(isColor != -1){
                                        // same color is already present so replace previous details

                                        let previousFinalID = agentDetails.registeredTickets[isAdded].allRange[isColor].finalId;
                                        let currentInitialId = initialId;
                                        console.log("previous final id", +previousFinalID, currentInitialId)
                                        let isTicketsInTrack = false;
                                        if( (+previousFinalID + 1) == +currentInitialId){
                                            // keep track of previous tickets also
                                            rangeData = {
                                                id: (+new Date()).toString(),
                                                ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                                initialId: agentDetails.registeredTickets[isAdded].allRange[isColor].initialId,
                                                finalId: finalId,
                                                ticketsAvailableFrom: agentDetails.registeredTickets[isAdded].allRange[isColor].ticketsAvailableFrom,
                                                //ticketIds: ticketIdArray,
                                                lastUpdatedDate: new Date()
                                            }
                                            isTicketsInTrack = true;
                                            console.log("rangeData---", rangeData)
                                        }
                                        let updatedAgent = await Sys.App.Services.AgentServices.updateAgentNested({  _id: agentDetails._id }, {
                                            $set: {
                                                'registeredTickets.$[current].allRange.$[current1].initialId': rangeData.initialId,
                                                'registeredTickets.$[current].allRange.$[current1].finalId': rangeData.finalId,
                                                'registeredTickets.$[current].allRange.$[current1].ticketsAvailableFrom': rangeData.ticketsAvailableFrom,
                                                'registeredTickets.$[current].allRange.$[current1].lastUpdatedDate': rangeData.lastUpdatedDate,
                                                'registeredTickets.$[current].allRange.$[current1].isTicketsInTrack': isTicketsInTrack,
                                            },
                                            $push: {
                                                'registeredTickets.$[current].allRange.$[current1].ticketIds': {$each: ticketIdArray}
                                            }
                                          }, { arrayFilters: [ {"current.hallId": req.session.details.hall[0].id}, {"current1.ticketColor": searchTicketColor} ], new: true }
                                        );
                                        console.log("updated Agent when same color data found", updatedAgent)

                                    }else{
                                        // coor is not present add new data

                                        let updatedAgent = await Sys.App.Services.AgentServices.updateAgentNested({ _id: agentDetails._id, 'registeredTickets.hallId': req.session.details.hall[0].id  }, 
                                            {  
                                                $push:{"registeredTickets.$.allRange": rangeData },
                                            },
                                            {new: true}
                                        );
                                        console.log("updated Agent when new range pushed", updatedAgent)
                                    }
                                }else{
                                    let registeredTickets = {
                                        hallName: req.session.details.hall[0].name,
                                        hallId: req.session.details.hall[0].id,
                                        allRange: [
                                            {
                                                id: (+new Date()).toString(),
                                                ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                                initialId: initialId,
                                                finalId: finalId,
                                                ticketsAvailableFrom: initialId,
                                                ticketIds: ticketIdArray,
                                                isTicketsInTrack: true,
                                                lastUpdatedDate: new Date()
                                            }
                                        ]
                                    }
                                    let updatedAgent = await Sys.App.Services.AgentServices.updateAgentNested({ _id: agentDetails._id }, 
                                        {  
                                            $push:{"registeredTickets": registeredTickets },
                                        },
                                        {new: true}
                                    );
                                    console.log("another ticket color added", updatedAgent)
                                }
                                res.send({status: "success", message: "Data Udpated Successfully."});
                            }
                            

                        }else{
                            res.send({status: "fail", message: "Please provide valid range of ticket Ids."});
                        }
                    }else{
                        res.send({status: "fail", message: "Tickets Data Not Found."});
                    }
                    
                    //let tickets = 
                }else{
                    res.send({status: "fail", message: "Agent Not Found."});
                }
            }else{
                res.send({status: "fail", message: "Agent Not Found."});
            }
        } catch (error) {
            Sys.Log.error('Error in addPhysicalTickets: ', error);
            return new Error(error);
        }
    },

    getPhysicalTickets: async function(req, res) {
        try {
            let ticketData = [];
            if(req.session.details && req.session.details.is_admin == "no" && req.session.details.id){
                let agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: req.session.details.id }, ['hall', 'registeredTickets']);
                let agentHall = req.session.details.hall[0].name;
                console.log("agentDetails---", agentDetails, agentHall);
                if(agentDetails && agentHall && agentDetails.registeredTickets.length > 0){
                    let isTickets = agentDetails.registeredTickets.findIndex((e) => e.hallId == req.session.details.hall[0].id);
                    if(isTickets != -1){
                        let registeredTickets = agentDetails.registeredTickets[isTickets].allRange;
                        if(registeredTickets.length > 0){
                            for(let i=0; i < registeredTickets.length; i++){
                                ticketData.push(registeredTickets[i]);
                            }
                        }
                    }
                }
            }
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketData.length,
                'recordsFiltered': ticketData.length,
                'data': ticketData,
            };
            res.send(obj);
        } catch (error) {
            Sys.Log.error('Error in getPhysicalTickets: ', error);
            return new Error(error);
        }
    },

    deletePhysicalTicket: async function(req, res) {
        try {console.log("delete ticket", req.body)
            if(req.session.details && req.session.details.is_admin == "no" && req.session.details.id){
                let agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: req.session.details.id }, ['hall', 'registeredTickets']);
                let agentHall = req.session.details.hall[0].name;
                console.log("agentDetails---", agentDetails, agentHall);
                if(agentDetails && agentHall && agentDetails.registeredTickets.length > 0){
                    const isTickets = agentDetails.registeredTickets.findIndex((e) => e.hallId == req.session.details.hall[0].id);
                    let registeredTickets = agentDetails.registeredTickets[isTickets].allRange;
                    if(registeredTickets.length > 0){
                        let isColor = agentDetails.registeredTickets[isTickets].allRange.findIndex((e) => e.id == req.body.id);
                        console.log("isColor", isColor)
                        if(isColor != -1){
                            let updatedAgent = await Sys.App.Services.AgentServices.updateAgentNested({  _id: agentDetails._id, 'registeredTickets.hallId': req.session.details.hall[0].id }, {
                                $pull : {"registeredTickets.$.allRange" : {"id":req.body.id}}
                              }, { new: true }
                            );
                            console.log("updated Agent when same color data found", updatedAgent)
                            return res.send("success");
                        }else{
                            return res.send("error");
                        }
                    }
                }else{
                    return res.send("error");
                }
            }
            
        } catch (error) {
            Sys.Log.error('Error in getPhysicalTickets: ', error);
            return new Error(error);
        }
    },

    addGamePhysicalTicketsPost: async function(req, res) {
        try {
            console.log("req.query", req.body, req.params, req.session.details)
            let finalId = req.body.finalId;
            if(!finalId){
                res.send({status: "fail", message: "Please provide ticket Id."});
            }
            let game = await Sys.App.Services.GameService.getSingleGameData({_id: req.body.gameId}, {registeredPhysicalTickets: 1, status: 1});
            console.log("game data", game)
            if(!game){
                res.send({status: "fail", message: "Game Not Found."});
            }else{
                if(game.status == "running" || game.status == "finish"){
                    res.send({status: "fail", message: "Game already started or finished."});
                }
            }
            if(req.session.details && req.session.details.id){
                let agentDetails; 
                let agentHall;
                let hallId;
                let ticketDetails= await Sys.App.Services.GameService.getSingleStaticPhysicalTicketsByData({ ticketId: finalId }, {hallName: 1, ticketColor: 1, ticketType: 1});
                console.log("hallName", ticketDetails);
                if(!ticketDetails){
                    res.send({status: "fail", message: "Tickets Data Not Found."});
                }
                if(req.session.details.is_admin == "yes"){
                    // get hallId, then agentDetails from hallId
                   
                    agentHall = ticketDetails.hallName;
                    agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ hall: { $elemMatch: {"name": agentHall} } }, ['hall', 'registeredTickets']);
                    if(agentDetails){
                        let isHall = agentDetails.hall.findIndex((e) => e.name == agentHall);
                        if(isHall != -1){
                            hallId = agentDetails.hall[isHall].id;
                        }
                    }
                    
                }else{
                    agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: req.session.details.id }, ['hall', 'registeredTickets']);
                    agentHall = req.session.details.hall[0].name;
                    hallId = req.session.details.hall[0].id;
                }
                
                console.log("agentDetails---", agentDetails, agentHall);
                if(agentDetails && agentHall){
                    let registeredTickets = agentDetails.registeredTickets;
                    if(registeredTickets.length > 0){
                        let searchTicketColor = (ticketDetails.ticketType == "traffic-light") ? "traffic-light" : ticketDetails.ticketColor;
                        let isAdded = registeredTickets.findIndex((e) => e.hallId == hallId);
                        if(isAdded != -1){
                            let isColor = registeredTickets[isAdded].allRange.findIndex((e) => e.ticketColor == searchTicketColor);
                            console.log("isColor", isColor);
                            let purchasingTicket = registeredTickets[isAdded].allRange[isColor];
                            console.log("purchasingTicket", purchasingTicket);
                            if( (+finalId <= +purchasingTicket.finalId) && (+finalId >= +purchasingTicket.ticketsAvailableFrom) ){
                                let purInitialId = +purchasingTicket.ticketsAvailableFrom;
                                let purFinalId = (+finalId - 1);
                                console.log("tickets purchased range", purInitialId, purFinalId);

                                if(game.registeredPhysicalTickets.length == 0) {
                                    let registeredTickets = {
                                        hallName: agentHall,
                                        hallId: hallId,
                                        allRange: [
                                            {
                                                id: (+new Date()).toString(),
                                                ticketColor: searchTicketColor,
                                                initialId: purInitialId,
                                                finalId: purFinalId,
                                                ticketsAvailableFrom: purFinalId+1,
                                                lastUpdatedDate: new Date()
                                            }
                                        ]
                                    }
                                    console.log("registeredTickets", registeredTickets)

                                    await Sys.App.Services.GameService.updateGameData({ _id: req.body.gameId }, {
                                        registeredPhysicalTickets: registeredTickets
                                    });
                                   
                                }else{
                                    const isAdded = game.registeredPhysicalTickets.findIndex((e) => e.hallId == hallId);
                                    if(isAdded != -1){
                                        let rangeData = {
                                            id: (+new Date()).toString(),
                                            ticketColor: searchTicketColor,
                                            initialId: purInitialId,
                                            finalId: purFinalId,
                                            ticketsAvailableFrom: purFinalId+1,
                                            lastUpdatedDate: new Date()
                                        }
                                        console.log("allRange of purchase ticket",  game.registeredPhysicalTickets[isAdded]);
                                        console.log("searchTicketColor---", searchTicketColor)
                                        let isColor = game.registeredPhysicalTickets[isAdded].allRange.findIndex((e) => e.ticketColor == searchTicketColor );
                                        console.log("isColor--", isColor)
                                        if(isColor != -1){
                                            // same color is already present so replace previous details
                                
                                            let previousFinalID = game.registeredPhysicalTickets[isAdded].allRange[isColor].finalId;
                                            let currentInitialId = purInitialId;
                                            console.log("previous final id", +previousFinalID, currentInitialId)
                                
                                            if( (+previousFinalID + 1) == +currentInitialId){
                                                // keep track of previous tickets also
                                                rangeData = {
                                                    id: (+new Date()).toString(),
                                                    ticketColor: searchTicketColor,
                                                    initialId: +currentInitialId,
                                                    finalId: +purFinalId,
                                                    ticketsAvailableFrom: purFinalId+1,
                                                    lastUpdatedDate: new Date()
                                                }
                                
                                                console.log("rangeData---", rangeData)
                                            }
                                            let updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({  _id: req.body.gameId }, {
                                                $set: {
                                                    'registeredPhysicalTickets.$[current].allRange.$[current1]': rangeData,
                                                },
                                              }, { arrayFilters: [ {"current.hallId": hallId}, {"current1.ticketColor": searchTicketColor} ], new: true }
                                            );
                                            console.log("updated Agent when same color data found", updateGame)
                                
                                        }else{
                                            // color is not present add new data
                                
                                            let updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: req.body.gameId, 'registeredPhysicalTickets.hallId': hallId  }, 
                                                {  
                                                    $push:{"registeredPhysicalTickets.$.allRange": rangeData },
                                                },
                                                {new: true}
                                            );
                                            console.log("updated Agent when new range pushed", updateGame)
                                        }
                                    }else{
                                        let registeredTickets = {
                                            hallName: agentHall,
                                            hallId: hallId,
                                            allRange: [
                                                {
                                                    id: (+new Date()).toString(),
                                                    ticketColor: searchTicketColor,
                                                    initialId: purInitialId,
                                                    finalId: purFinalId,
                                                    ticketsAvailableFrom: purFinalId+1,
                                                    lastUpdatedDate: new Date()
                                                }
                                            ]
                                        }
                                        let updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: req.body.gameId }, 
                                            {  
                                                $push:{"registeredPhysicalTickets": registeredTickets },
                                            },
                                            {new: true}
                                        );
                                        console.log("another ticket color added", updatedGame)
                                    }
                                }

                                res.send({status: "success", message: "Data Udpated Successfully."});

                            }else{
                                res.send({status: "fail", message: "Tickets not available."});
                            }
                        }else{
                            res.send({status: "fail", message: "Tickets Data Not Found."});
                        }
                    }else{
                        res.send({status: "fail", message: "Tickets Data Not Found."});
                    }


                    // let ticketIdArray = [];
                    // for(let i= +initialId; i <= +finalId; i++){
                    //     ticketIdArray.push(i.toString());
                    // }
                    // let ticketCount = ticketIdArray.length;
                    // console.log("all ticketIds", ticketIdArray, ticketCount);

                    // let ticketColorData = await Sys.App.Services.GameService.getSingleStaticPhysicalTicketsByData({ ticketId: initialId }, {ticketColor: 1});
                    // console.log("ticketColor---", ticketColorData);
                    // if(ticketColorData){
                    //     let traficLightColors = ['Small Red', 'Small Yellow', 'Small Green'];
                    //     let count =0;
                    //     if(traficLightColors.includes(ticketColorData.ticketColor) == true ){
                    //         count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ ticketId: {$in: ticketIdArray}, hallName: agentHall, ticketColor: {$in: traficLightColors} });
                    //     }else{
                    //         count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ ticketId: {$in: ticketIdArray}, hallName: agentHall, ticketColor: ticketColorData.ticketColor });
                    //     }
                    //     console.log("count--", count, { ticketId: {$in: ticketIdArray}, hallName: agentHall,  ticketColor: ticketColorData.ticketColor })
                    //     if(ticketCount == count){
                    //         // add this range of tickets
                    //         if(agentDetails.registeredTickets.length == 0) {
                    //             let registeredTickets = {
                    //                 hallName: req.session.details.hall[0].name,
                    //                 hallId: req.session.details.hall[0].id,
                    //                 allRange: [
                    //                     {
                    //                         id: (+new Date()).toString(),
                    //                         ticketColor: ticketColorData.ticketColor,
                    //                         initialId: initialId,
                    //                         finalId: finalId,
                    //                         ticketsAvailableFrom: initialId,
                    //                         lastUpdatedDate: new Date()
                    //                     }
                    //                 ]
                    //             }
                    //             await Sys.App.Services.AgentServices.FindOneUpdate({ _id: agentDetails._id }, { registeredTickets: registeredTickets });
                    //         }else{
                    //             const isAdded = agentDetails.registeredTickets.findIndex((e) => e.hallId == req.session.details.hall[0].id);
                    //             if(isAdded != -1){
                    //                 let rangeData = {
                    //                     id: (+new Date()).toString(),
                    //                     ticketColor: ticketColorData.ticketColor,
                    //                     initialId: initialId,
                    //                     finalId: finalId,
                    //                     ticketsAvailableFrom: initialId,
                    //                     lastUpdatedDate: new Date()
                    //                 }
                    //                 console.log(" agentDetails.registeredTickets[isAdded].allRange",  agentDetails.registeredTickets[isAdded])
                    //                 let isColor = agentDetails.registeredTickets[isAdded].allRange.findIndex((e) => e.ticketColor == ticketColorData.ticketColor);
                    //                 if(isColor != -1){
                    //                     // same color is already present so replace previous details

                    //                     let previousFinalID = agentDetails.registeredTickets[isAdded].allRange[isColor].finalId;
                    //                     let currentInitialId = initialId;
                    //                     console.log("previous final id", +previousFinalID, currentInitialId)

                    //                     if( (+previousFinalID + 1) == +currentInitialId){
                    //                         // keep track of previous tickets also
                    //                         rangeData = {
                    //                             id: (+new Date()).toString(),
                    //                             ticketColor: ticketColorData.ticketColor,
                    //                             initialId: agentDetails.registeredTickets[isAdded].allRange[isColor].initialId,
                    //                             finalId: finalId,
                    //                             ticketsAvailableFrom: agentDetails.registeredTickets[isAdded].allRange[isColor].ticketsAvailableFrom,
                    //                             lastUpdatedDate: new Date()
                    //                         }
                    //                     }
                    //                     let updatedAgent = await Sys.App.Services.AgentServices.updateAgentNested({  _id: agentDetails._id }, {
                    //                         $set: {
                    //                             'registeredTickets.$[current].allRange.$[current1]': rangeData,
                    //                         },
                    //                       }, { arrayFilters: [ {"current.hallId": req.session.details.hall[0].id}, {"current1.ticketColor": ticketColorData.ticketColor} ], new: true }
                    //                     );
                    //                     console.log("updated Agent when same color data found", updatedAgent)

                    //                 }else{
                    //                     // coor is not present add new data

                    //                     let updatedAgent = await Sys.App.Services.AgentServices.updateAgentNested({ _id: agentDetails._id, 'registeredTickets.hallId': req.session.details.hall[0].id  }, 
                    //                         {  
                    //                             $push:{"registeredTickets.$.allRange": rangeData },
                    //                         },
                    //                         {new: true}
                    //                     );
                    //                     console.log("updated Agent when new range pushed", updatedAgent)
                    //                 }
                    //             }else{
                    //                 let registeredTickets = {
                    //                     hallName: req.session.details.hall[0].name,
                    //                     hallId: req.session.details.hall[0].id,
                    //                     allRange: [
                    //                         {
                    //                             id: (+new Date()).toString(),
                    //                             ticketColor: ticketColorData.ticketColor,
                    //                             initialId: initialId,
                    //                             finalId: finalId,
                    //                             ticketsAvailableFrom: initialId,
                    //                             lastUpdatedDate: new Date()
                    //                         }
                    //                     ]
                    //                 }
                    //                 let updatedAgent = await Sys.App.Services.AgentServices.updateAgentNested({ _id: agentDetails._id }, 
                    //                     {  
                    //                         $push:{"registeredTickets": registeredTickets },
                    //                     },
                    //                     {new: true}
                    //                 );
                    //                 console.log("another ticket color added", updatedAgent)
                    //             }
                    //             res.send({status: "success", message: "Data Udpated Successfully."});
                    //         }
                            

                    //     }else{
                    //         res.send({status: "fail", message: "Please provide valid range of ticket Ids."});
                    //     }
                    // }else{
                    //     res.send({status: "fail", message: "Tickets Data Not Found."});
                    // }
                    
                    //let tickets = 
                }else{
                    res.send({status: "fail", message: "Agent Not Found."});
                }
            }else{
                res.send({status: "fail", message: "Agent Not Found."});
            }
        } catch (error) {
            Sys.Log.error('Error in addPhysicalTickets: ', error);
            return new Error(error);
        }
    },*/

    addPhysicalTicketsPost: async function (req, res) {
        try {
            let viewFlag = true;
            let addFlag = true;
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
                // let stringReplace = req.session.details.isPermission['Physical Ticket Management'];
                if (stringReplace) {
                    if (stringReplace?.indexOf("view") == -1) {
                        viewFlag = false;
                    }
                    if (stringReplace?.indexOf("add") == -1) {
                        addFlag = false;
                    }
                } else {
                    viewFlag = false;
                    addFlag = false;
                }
            }
            if (viewFlag == false || addFlag == false) {
                //req.flash('error',await Sys.Helper.bingo.getTraslateData(["game_name_already_exists"], req.session.details.language)) //'You are Not allowed to access that page.');
                //return res.redirect('/dashboard');
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_access"], req.session.details.language) /* "You are Not allowed to access." */ });
            }
            console.log("req.query", req.body, req.params, req.session.details);
    
            
            let agentHall, agentHallId, agentHallNumber, createrId = req.session.details.id;
            let hallDetails = null;
            if (req.session.details && req.session.details.is_admin == "no" && req.session.details.id) {
                let agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: req.session.details.id }, ['hall', 'registeredTickets']);
                agentHall = req.session.details.hall[0].name;
                agentHallId = req.session.details.hall[0].id;
                console.log("agentDetails---", agentDetails, agentHall);

                // check if this is the active agent for the hall
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData({ _id: agentHallId }, { activeAgents: 1, otherData: 1, number: 1 });
                const currentActiveAgent = hallDetails?.activeAgents?.find(agent => agent.id === createrId);
                if (!hallDetails.activeAgents || hallDetails.activeAgents.length == 0 || !currentActiveAgent ) { // hallDetails.activeAgents[0].id != createrId
                    return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["this_agent_is_not_active_in_hall"], req.session.details.language) }); 
                }

            } else if (req.session.details && req.session.details.is_admin == "yes" && req.session.details.id && req.body.hallId) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.body.hallId }, ["name", "otherData", "number"]);
                agentHall = hallDetails.name;
                agentHallId = req.body.hallId;
            } else {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["agent_not_found"], req.session.details.language) }); //"Agent Not Found." });
            }

            if (hallDetails.otherData?.isPreviousDaySettlementPending == true) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_do_previous_day_settlement_before_registering_the_new_tickets"], req.session.details.language) }); //'Please Do previous day settlement before Registering the new Tickets.' });
            }

            agentHallNumber = hallDetails.number;

            if (agentHallId && agentHall && agentHallNumber) {
                let initialId = +req.body.initialId;
                let ticketIdArray = [];
                let ticketColorData = await Sys.App.Services.GameService.getSingleStaticPhysicalTicketsByData({ ticketId: initialId, hallNumber: agentHallNumber }, { ticketColor: 1, ticketType: 1 });
                console.log("ticketColor---", ticketColorData);
                if(!ticketColorData){
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_data_not_found"], req.session.details.language) }); //"Tickets Data Not Found." });
                }
                
                let finalId =
                    +req.body.finalId ||
                    (ticketColorData.ticketType === "traffic-light" || ticketColorData.ticketColor.toLowerCase().includes("large")
                        ? initialId + 299
                        : ticketColorData.ticketColor.toLowerCase().includes("small")
                        ? initialId + (100 - 1) * 5
                        : initialId + 99);
                
                if (!initialId || !finalId) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_ticket_Id's"], req.session.details.language) }); /* "Please provide ticket Id's." */
                }
                if (initialId > finalId) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["final_id_should_be_greater_than_initial_Id"], req.session.details.language) }); //"Final Id Should be greater than Initial Id." });
                }

                if (ticketColorData.ticketType != "traffic-light" && ticketColorData.ticketColor.toLowerCase().includes("small")) {
                    for (let i = initialId; i <= finalId; i += 5) ticketIdArray.push(i.toString());
                }else{
                    for (let i = initialId; i <= finalId; i++) ticketIdArray.push(i.toString());
                }
 
                let ticketCount = ticketIdArray.length;
                //console.log("all ticketIds", ticketIdArray, ticketCount);
    
                // let count =0;
                // if (ticketColorData.ticketType == "traffic-light") { //if(traficLightColors.includes(ticketColorData.ticketColor) == true ){
                //     //count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ ticketId: {$in: ticketIdArray}, hallName: agentHall, ticketType: "traffic-light" });
                //     count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ $and: [{ $expr: { $gte: [{ $toDouble: "$ticketId" }, +initialId] } }, { $expr: { $lte: [{ $toDouble: "$ticketId" }, +finalId] } }], hallName: agentHall, ticketType: "traffic-light" });
                // } else {
                //     count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ $and: [{ $expr: { $gte: [{ $toDouble: "$ticketId" }, +initialId] } }, { $expr: { $lte: [{ $toDouble: "$ticketId" }, +finalId] } }], hallName: agentHall, ticketColor: ticketColorData.ticketColor });
                // }
                let count = 0;

                // Prepare the base query object
                const query = {
                    hallNumber: agentHallNumber, //hallName: agentHall,
                    ticketId: { $in: ticketIdArray } // Use $in with the array of ticket IDs
                };

                // Add conditions based on ticket type
                if (ticketColorData.ticketType === "traffic-light") {
                    query.ticketType = "traffic-light"; // Add ticketType for traffic-light
                } else {
                    query.ticketColor = ticketColorData.ticketColor; // Add ticketColor for other types
                }

                // Execute the count query
                count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount(query);
                
                // If we have to consider availbale ticket instead of strict 100 tickets
                //const matchedTickets = await Sys.App.Services.GameService.getStaticPhysicalTicketsByData(query, {ticketId: 1})
                
                //ticketIdArray = matchedTickets.map(ticket => ticket.ticketId);
               
                //console.log("count--", count, ticketCount, { hallName: agentHall, ticketColor: ticketColorData.ticketColor }, initialId, finalId)
                // if(ticketIdArray.length > 0 &&  ticketCount !== count){
                //     finalId = ticketIdArray[ticketIdArray.length -1]
                // }
                if (ticketCount == count) {
                    // add this range of tickets
                    let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallId: agentHallId }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                    if (registeredTickets) {
                        let rangeData = {
                            id: (+new Date()).toString(),
                            ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                            initialId: initialId,
                            finalId: finalId,
                            ticketsAvailableFrom: initialId,
                            ticketIds: ticketIdArray,
                            agentId: createrId,
                            soldTicketIDs: [],
                            holdTicketIds: [],
                            lastUpdatedDate: new Date()
                        }
                        //console.log(" registeredTickets of hall ",  registeredTickets);
                        let searchTicketColor = (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor;
                        //console.log("searchTicketColor---", searchTicketColor)
                        let isColor = registeredTickets.allRange.findIndex((e) => e.ticketColor == searchTicketColor);
                        //console.log("isColor--", isColor)
                        if (isColor != -1) {
                            // same color is already present so replace previous details

                            let previousFinalID = +registeredTickets.allRange[isColor].finalId;
                            let currentInitialId = initialId;
                            console.log("previous final id", +previousFinalID, currentInitialId)
                            let isTicketsInTrack = false;
                            if ((+previousFinalID + 1) == +currentInitialId) {
                                // keep track of previous tickets also
                                rangeData = {
                                    id: (+new Date()).toString(),
                                    ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                    initialId: registeredTickets.allRange[isColor].initialId,
                                    finalId: finalId,
                                    ticketsAvailableFrom: registeredTickets.allRange[isColor].ticketsAvailableFrom,
                                    //ticketIds: ticketIdArray,
                                    agentId: createrId,
                                    lastUpdatedDate: new Date()
                                }
                                isTicketsInTrack = true;
                                console.log("rangeData---", rangeData)
                            } else {
                                if (currentInitialId <= previousFinalID) {
                                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["can_not_register_ticket_id_multiple_time"], req.session.details.language) }); //"Can not register ticket Id multiple time." });
                                } else {
                                    rangeData = {
                                        id: (+new Date()).toString(),
                                        ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                        initialId: +registeredTickets.allRange[isColor].initialId,
                                        finalId: finalId,
                                        ticketsAvailableFrom: +registeredTickets.allRange[isColor].ticketsAvailableFrom,
                                        agentId: createrId,
                                        lastUpdatedDate: new Date()
                                    }
                                }
                            }
                            let updatedTickets = await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: agentHallId }, {
                                $set: {
                                    'allRange.$[current1].initialId': rangeData.initialId,
                                    'allRange.$[current1].finalId': rangeData.finalId,
                                    'allRange.$[current1].ticketsAvailableFrom': rangeData.ticketsAvailableFrom,
                                    'allRange.$[current1].lastUpdatedDate': rangeData.lastUpdatedDate,
                                    'allRange.$[current1].isTicketsInTrack': isTicketsInTrack,
                                    'allRange.$[current1].agentId': rangeData.agentId,
                                },
                                $push: {
                                    'allRange.$[current1].ticketIds': { $each: ticketIdArray }
                                }
                            }, { arrayFilters: [{ "current1.ticketColor": searchTicketColor }], new: true }
                            );
                            console.log("updated Agent when same color data found", updatedTickets)

                        } else {
                            // color is not present add new data

                            let updatedTickets = await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: agentHallId },
                                {
                                    $push: { "allRange": rangeData },
                                },
                                { new: true }
                            );
                            console.log("updated Agent when new range pushed", updatedTickets)
                        }

                    } else {
                        let registeredTickets = {
                            hallName: agentHall,
                            hallId: agentHallId,
                            hallNumber: agentHallNumber,
                            agentId: createrId,
                            allRange: [
                                {
                                    id: (+new Date()).toString(),
                                    ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                    initialId: initialId,
                                    finalId: finalId,
                                    ticketsAvailableFrom: initialId,
                                    ticketIds: ticketIdArray,
                                    soldTicketIDs: [],
                                    holdTicketIds: [],
                                    isTicketsInTrack: true,
                                    agentId: createrId,
                                    lastUpdatedDate: new Date(),

                                }
                            ]
                        }
                        await Sys.App.Services.scheduleServices.insertAgentRegisteredTicketData(registeredTickets);
                    }
                    return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_added_successfully"], req.session.details.language) }); //"Tickets added successfully." });

                } else {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_valid_rang_of_ticket_Ids"], req.session.details.language) }); //"Please provide valid range of ticket Ids." });
                }
                
            } else {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["agent_not_found"], req.session.details.language) }); //"Agent Not Found." });
            }
    
        } catch (error) {
            Sys.Log.error('Error in addPhysicalTickets: ', error);
            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language) }); //"Something went wrong." });
            //return new Error(error);
        }
    },

    getPhysicalTickets: async function (req, res) {
        try {
            console.log("getPhysicalTickets", req.body, req.params, req.query)
            let ticketData = [];
            let agentHall, agentHallId, hallDetails, agentHallNumber;

            const sessionDetails = req.session.details;
            
            if (sessionDetails?.is_admin === "no" && sessionDetails?.id) {
                agentHall = sessionDetails?.hall?.[0]?.name;
                agentHallId = sessionDetails?.hall?.[0]?.id;
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: agentHallId }, 
                    ["number"]
                );
            } else if (sessionDetails?.is_admin === "yes" && req.query.hallId && sessionDetails?.id) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: req.query.hallId }, 
                    ["name", "number"]
                );
                agentHall = hallDetails.name;
                agentHallId = req.query.hallId;
            }

            agentHallNumber = hallDetails?.number;

            if (agentHall && agentHallId && agentHallNumber) {
                let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallId: agentHallId, hallNumber: agentHallNumber }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                if (registeredTickets && registeredTickets.allRange.length > 0) {
                    if (registeredTickets.allRange.length > 0) {
                        for (let i = 0; i < registeredTickets.allRange.length; i++) {
                            ticketData.push({
                                "id": registeredTickets.allRange[i].id,
                                "ticketColor": registeredTickets.allRange[i].ticketColor,
                                "initialId": registeredTickets.allRange[i].initialId,
                                "finalId": registeredTickets.allRange[i].finalId,
                                "soldTicketCount": (registeredTickets.allRange[i].soldTicketIDs?.length - registeredTickets.allRange[i].holdTicketIds?.length),
                            });
                        }
                    }
                }
            }
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketData.length,
                'recordsFiltered': ticketData.length,
                'data': ticketData,
            };
            res.send(obj);
        } catch (error) {
            Sys.Log.error('Error in getPhysicalTickets: ', error);
            return new Error(error);
        }
    },

    deletePhysicalTicket: async function (req, res) {
        try {
            let agentHall, agentHallId, hallDetails, agentHallNumber;

            const sessionDetails = req.session.details;
            
            if (sessionDetails?.is_admin === "no" && sessionDetails?.id) {
                agentHall = sessionDetails?.hall?.[0]?.name;
                agentHallId = sessionDetails?.hall?.[0]?.id;
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: agentHallId }, 
                    ["number"]
                );
            } else if (sessionDetails?.is_admin === "yes" && req.body.hallId && sessionDetails?.id) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: req.body.hallId }, 
                    ["name", "number"]
                );
                agentHall = hallDetails.name;
                agentHallId = req.body.hallId;
            } else {
                return res.send("error");
            }

            agentHallNumber = hallDetails?.number;

            if (agentHallId && agentHall && agentHallNumber) {
                let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallId: agentHallId, hallNumber: agentHallNumber }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                if (registeredTickets && registeredTickets.allRange.length > 0) {
                    let isColor = registeredTickets.allRange.findIndex((e) => e.id == req.body.id);
                    console.log("isColor", isColor)
                    if (isColor != -1) {
                        let updatedTicket = await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: agentHallId, hallNumber: agentHallNumber }, {
                            $pull: { "allRange": { "id": req.body.id } }
                        }, { new: true }
                        );
                        console.log("updated hall when same color data found", updatedTicket)
                        return res.send("success");
                    } else {
                        return res.send("error");
                    }
                } else {
                    return res.send("error");
                }
            } else {
                return res.send("error");
            }

        } catch (error) {
            Sys.Log.error('Error in deletePhysicalTicket: ', error);
            return new Error(error);
        }
    },

    getLastRegisteredId: async function (req, res) {
        try {
            console.log("getLastRegisteredId", req.body, req.params, req.query);

            let agentHall, agentHallId, hallDetails, agentHallNumber;

            const sessionDetails = req.session.details;
            console.log("sessionDetails---", sessionDetails)
            if (sessionDetails?.is_admin === "no" && sessionDetails?.id) {
                agentHall = sessionDetails?.hall?.[0]?.name;
                agentHallId = sessionDetails?.hall?.[0]?.id;
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: agentHallId }, 
                    ["number"]
                );
            } else if (sessionDetails?.is_admin === "yes" && req.query.hallId && sessionDetails?.id) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: req.query.hallId }, 
                    ["name", "number"]
                );
                agentHall = hallDetails.name;
                agentHallId = req.query.hallId;
            } else {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["agent_not_found"], req.session.details.language) }); // "Agent Not Found." });
            }
            console.log("hall details---", hallDetails)
            agentHallNumber = hallDetails?.number;
            console.log("query---", { ticketId: req.query.initialId, hallNumber: agentHallNumber })
            let ticketColorData = await Sys.App.Services.GameService.getSingleStaticPhysicalTicketsByData({ ticketId: req.query.initialId, hallNumber: agentHallNumber }, { ticketColor: 1, ticketType: 1, hallName: 1 });
            console.log("ticketColor---", ticketColorData);
            if (!ticketColorData) {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_data_not_found"], req.session.details.language) }); // "Tickets Data Not Found." });
            }
            let ticketColor;
            if (ticketColorData.ticketType == "traffic-light") {
                ticketColor = "traffic-light";
            } else {
                ticketColor = ticketColorData.ticketColor;
            }

            let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallNumber: agentHallNumber }, { hallId: 1, hallName: 1, allRange: 1 }, {});
            if (registeredTickets) {
                if (registeredTickets.allRange.length > 0) {
                    for (let i = 0; i < registeredTickets.allRange.length; i++) {
                        if (registeredTickets.allRange[i].ticketColor == ticketColor) {
                            let lastId = "";
                            if (registeredTickets.allRange[i].ticketIds.length > 0) {
                                lastId = registeredTickets.allRange[i].ticketIds[registeredTickets.allRange[i].ticketIds.length - 1];
                            }
                            return res.send({ status: "success", lastId: lastId });
                        }
                    }
                    return res.send({ status: "success", lastId: "" });
                }
                return res.send({ status: "success", lastId: "" });
            } else {
                return res.send({ status: "success", lastId: "" });
            }


        } catch (error) {
            Sys.Log.error('Error in getLastRegisteredId: ', error);
            return res.status(500).send(error);
        }
    },

    addGamePhysicalTicketsPost: async function (req, res) {
        try {
            Sys.Log.info("req.query of addGamePhysicalTicketsPost", req.body, req.params, req.session.details)
            let finalId = +req.body.finalId;
            const startDate = new Date();
            const endDate = new Date();
            startDate.setHours(0, 0, 0);
            endDate.setHours(23, 59, 59);
            if (!finalId) {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_ticket_id"], req.session.details.language) }); // "Please provide ticket Id." });
            }
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.gameId }, { registeredPhysicalTickets: 1, status: 1, subGames: 1, gameName: 1, halls: 1, withdrawNumberArray: 1, parentGameId: 1, sequence: 1,  'otherData.isTestGame': 1  });
            Sys.Log.info("game data", game)
           
            if (!game) {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["game_not_found"], req.session.details.language) }); // "Game Not Found." });
            } 

            if (game.status == "finish") {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["game_already_finished"], req.session.details.language) }); // "Game already started or finished." });
            }

            if(game.sequence == 0 || game?.otherData?.isTestGame){
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["game1_test_game_validation_physical"], req.session.details.language) });
            }

            if (req.session.details && req.session.details.id) {
                let agentDetails, agentHall, hallId, hallDetails, createrId = req.session.details.id;
                let ticketDetails = await Sys.App.Services.GameService.getSingleStaticPhysicalTicketsByData({ ticketId: finalId }, { hallName: 1, ticketColor: 1, ticketType: 1 });
                console.log("ticketDetails----", ticketDetails)
                if (!ticketDetails) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_data_not_found"], req.session.details.language) }); // "Tickets Data Not Found." });
                }

                let gameAssignedColors = game.subGames[0]?.ticketColorTypes;
                console.log("gameAssignedColors---", gameAssignedColors);
                if (gameAssignedColors && gameAssignedColors.length > 0) {
                    if (game.gameName == "Traffic Light") {
                        // let isFounded = gameAssignedColors.some( val => ["Small Red", "Small Yellow", "Small Green"].includes(val) );
                        // if(!isFounded){
                        //     return res.send({status: "fail", message:await Sys.Helper.bingo.getTraslateData(["something_went_wrong"], req.session.details.language) }); // "Ticket Color isn't availbale to purchase in the game."});
                        // }
                        if (ticketDetails.ticketType != "traffic-light") {
                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["ticket_color_isn't_availbale_to_purchase_in_the_game"], req.session.details.language) }); // "Ticket Color isn't availbale to purchase in the game." });
                        }
                    } else {
                        if (ticketDetails.ticketType == "traffic-light" || gameAssignedColors.includes(ticketDetails.ticketColor) == false) {
                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["ticket_color_isn't_availbale_to_purchase_in_the_game"], req.session.details.language) }); // "Ticket Color isn't availbale to purchase in the game." });
                        }
                    }
                } else {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["ticket_color_isn't_availbale_to_purchase_in_the_game"], req.session.details.language) }); // "Ticket Color isn't availbale to purchase in the game." });
                }

                if (req.session.details.is_admin == "yes") {
                    // get hallId, then agentDetails from hallId

                    /*agentHall = ticketDetails.hallName;
                    agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ hall: { $elemMatch: {"name": agentHall} } }, ['hall', 'registeredTickets']);
                    if(agentDetails){
                        let isHall = agentDetails.hall.findIndex((e) => e.name == agentHall);
                        if(isHall != -1){
                            hallId = agentDetails.hall[isHall].id;
                        }
                    }*/

                    hallDetails = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.body.hallId }, ["name", "number"]);
                    agentHall = hallDetails.name;
                    hallId = req.body.hallId;
                    createrId = req.body.agentId;

                } else {
                    hallDetails = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.session.details.hall[0].id }, ["name", "number"]);
                    agentHall = req.session.details.hall[0].name;
                    hallId = req.session.details.hall[0].id;

                    let viewFlag = true;
                    let addFlag = true;
                    if(!req.session.details.isSuperAdmin){
                        // check if this is the active agent for the hall
                        let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, otherData: 1 });
                        const currentActiveAgent = hallsData?.activeAgents?.find(agent => agent.id === req.session.details.id);
                        if (!hallsData.activeAgents || hallsData.activeAgents.length == 0 || !currentActiveAgent ) { // hallDetails.activeAgents[0].id != createrId
                            return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["this_agent_is_not_active_in_hall"], req.session.details.language) }); 
                        }

                        if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                            return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_do_previous_day_settlement_before_selling_the_new_tickets"], req.session.details.language) }); //'Please Do previous day settlement before Registering the new Tickets.' });
                        }

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
                        // let stringReplace = req.session.details.isPermission['Physical Ticket Management'];
                        if (stringReplace) {
                            if (stringReplace?.indexOf("view") == -1) {
                                viewFlag = false;
                            }
                            if (stringReplace?.indexOf("add") == -1) {
                                addFlag = false;
                            }
                        } else {
                            viewFlag = false;
                            addFlag = false;
                        }
                    }
                    if (viewFlag == false || addFlag == false) {
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_access"], req.session.details.language) }); // "You are Not allowed to access." });
                    }
                }
                agentHallNumber = hallDetails?.number;
                if (hallId && agentHall && agentHallNumber) {

                    if (game.halls.length > 0) {
                        let playerHalls = [hallId.toString()];
                        let gameHalls = game.halls.map(function (item) {
                            return item.toString();
                        });
                        console.log("player approved halls", playerHalls, gameHalls)
                        const isHallmatched = playerHalls.some(r => gameHalls.includes(r));
                        console.log("isHallmatched", isHallmatched)
                        if (isHallmatched == false) {
                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_purchase_tickets_for_this_hall"], req.session.details.language) }); // "You are not allowed to purchase tickets for this hall." });
                        }
                    }

                    let registeredTicketsTemp = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallId: hallId, hallNumber: agentHallNumber }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                    console.log("registeredTicketsTemp---", registeredTicketsTemp, hallId, agentHall)
                    if (registeredTicketsTemp) {
                        let registeredTickets = registeredTicketsTemp.allRange;
                        if (registeredTickets.length > 0) {
                            let searchTicketColor = (ticketDetails.ticketType == "traffic-light") ? "traffic-light" : ticketDetails.ticketColor;

                            let isColor = registeredTickets.findIndex((e) => e.ticketColor == searchTicketColor);
                            console.log("isColor", isColor);
                            let purchasingTicket = registeredTickets[isColor];
                            console.log("purchasingTicket", purchasingTicket);
                            if (purchasingTicket && (finalId <= (+purchasingTicket.ticketIds[purchasingTicket.ticketIds.length - 1]) + 1) && (finalId >= +purchasingTicket.ticketIds[0])) {
                                let purInitialId = +purchasingTicket.ticketIds[0];
                                let purFinalId = (+finalId - 1);
                                console.log("tickets purchased range", purInitialId, purFinalId);

                                let purTicketIds = [];
                                let alreadySoldTickets = (purchasingTicket.soldTicketIDs) ? purchasingTicket.soldTicketIDs : [];
                                for (let i = 0; i < purchasingTicket.ticketIds.length; i++) {
                                    if (+purchasingTicket.ticketIds[i] >= purInitialId && +purchasingTicket.ticketIds[i] <= +purFinalId) {
                                        if (alreadySoldTickets.includes(purchasingTicket.ticketIds[i]) == false) {
                                            purTicketIds.push(purchasingTicket.ticketIds[i])
                                        }
                                    }
                                }
                                console.log("purTicketIds---", purTicketIds)

                                if (purTicketIds.length == 0) {

                                    let sellingTickets = await Sys.App.Services.scheduleServices.getSingleAgentSellPhysicalTicketData({ hallId: hallId, hallName: agentHall, gameId: game._id, agentId: createrId }, { hallId: 1, hallName: 1, allRange: 1 }, {});

                                    if (sellingTickets) {
                                        let isColor = sellingTickets.allRange.findIndex((e) => e.ticketColor == searchTicketColor);
                                        if (isColor == -1) {
                                            let rangeData = {
                                                id: (+new Date()).toString(),
                                                ticketColor: searchTicketColor,
                                                ticketIds: purTicketIds,
                                            }
                                            await Sys.App.Services.scheduleServices.updateAgentSellPhysicalTicketData({ hallId: hallId, hallNumber: agentHallNumber, agentId: createrId, gameId: game._id },
                                                {
                                                    $push: { "allRange": rangeData },
                                                },
                                                { new: true }
                                            );
                                            return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_updated_successfully_please_submit_to_sold_this_tickets"], req.session.details.language) }); // "Tickets Updated Successfully, Please Submit to sold this tickets." });
                                        } else {
                                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_not_available"], req.session.details.language) }); // "Tickets not available." });
                                        }
                                    } else {
                                        let registeredTickets = {
                                            hallName: agentHall,
                                            hallId: hallId,
                                            hallNumber: agentHallNumber,
                                            agentId: createrId,
                                            gameId: game._id,
                                            allRange: [
                                                {
                                                    id: (+new Date()).toString(),
                                                    ticketColor: searchTicketColor,
                                                    ticketIds: [],
                                                }
                                            ]
                                        }
                                        await Sys.App.Services.scheduleServices.insertAgentSellPhysicalTicketData(registeredTickets);
                                        return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_updated_successfully_please_submit_to_sold_this_tickets"], req.session.details.language) }); // "Tickets Updated Successfully, Please Submit to sold this tickets." });
                                    }


                                }

                                // get already added ticket data
                                if (purTicketIds.length > 0) {

                                    // add tickts in soldticket array in register ticket module
                                    //let allRegisteredTickets = purchasingTicket.ticketIds[0];
                                    let updatedTickets = await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: hallId }, {
                                        $push: {
                                            'allRange.$[current1].soldTicketIDs': { $each: purTicketIds },
                                            'allRange.$[current1].holdTicketIds': { $each: purTicketIds },
                                        }
                                    }, { arrayFilters: [{ "current1.ticketColor": searchTicketColor }], new: true }
                                    );
                                    console.log("updatedTickets after sell tickets", updatedTickets, { hallId: hallId, hallName: agentHall, gameId: game._id, agentId: createrId })

                                    let sellingTickets = await Sys.App.Services.scheduleServices.getSingleAgentSellPhysicalTicketData({ hallId: hallId, hallNumber: agentHallNumber, gameId: game._id, agentId: createrId }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                                    if (sellingTickets) {

                                        // update ids to the same color available
                                        let isColor = sellingTickets.allRange.findIndex((e) => e.ticketColor == searchTicketColor);
                                        if (isColor != -1) {
                                            await Sys.App.Services.scheduleServices.updateAgentSellPhysicalTicketData({ hallId: hallId, hallNumber: agentHallNumber, agentId: createrId, gameId: game._id },
                                                {
                                                    $push: {
                                                        'allRange.$[current1].ticketIds': { $each: purTicketIds }
                                                    }
                                                },
                                                { arrayFilters: [{ "current1.ticketColor": searchTicketColor }], new: true }
                                            );
                                        } else {
                                            let rangeData = {
                                                id: (+new Date()).toString(),
                                                ticketColor: searchTicketColor,
                                                ticketIds: purTicketIds,
                                            }
                                            await Sys.App.Services.scheduleServices.updateAgentSellPhysicalTicketData({ hallId: hallId, hallNumber: agentHallNumber, agentId: createrId, gameId: game._id },
                                                {
                                                    $push: { "allRange": rangeData },
                                                },
                                                { new: true }
                                            );
                                        }


                                    } else {
                                        let registeredTickets = {
                                            hallName: agentHall,
                                            hallId: hallId,
                                            hallNumber: agentHallNumber,
                                            agentId: createrId,
                                            gameId: game._id,
                                            allRange: [
                                                {
                                                    id: (+new Date()).toString(),
                                                    ticketColor: searchTicketColor,
                                                    ticketIds: purTicketIds,
                                                }
                                            ]
                                        }
                                        await Sys.App.Services.scheduleServices.insertAgentSellPhysicalTicketData(registeredTickets);
                                    }

                                    await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: req.body.gameId }, {
                                        $set: {
                                            "otherData.agents.$[current].scannedTickets.isScanned": true,
                                            "otherData.agents.$[current].scannedTickets.isPending": true,
                                        },
                                    }, { arrayFilters: [{ "current.id": mongoose.Types.ObjectId(createrId), "current.hallId": mongoose.Types.ObjectId(hallId) }], new: true })
                                    Sys.App.Controllers.agentcashinoutController.setHallStausWithColorCode({ gameId: req.body.gameId });

                                } else {
                                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_not_available"], req.session.details.language) }); // "Tickets not available." });
                                }

                                return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_updated_successfully_please_submit_to_sold_this_tickets"], req.session.details.language) }); // "Tickets Updated Successfully, Please Submit to sold this tickets." });

                            } else {
                                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_not_available"], req.session.details.language) }); // "Tickets not available." });
                            }

                        } else {
                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_data_not_found"], req.session.details.language) }); // "Tickets Data Not Found." });
                        }
                    } else {
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_data_not_found"], req.session.details.language) }); // "Tickets Data Not Found." });
                    }

                } else {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["agent_not_found"], req.session.details.language) }); // "Agent Not Found." });
                }
            } else {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["agent_not_found"], req.session.details.language) }); // "Agent Not Found." });
            }
        } catch (error) {
            Sys.Log.error('Error in addPhysicalTickets: ', error);
            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language) }); // "Something went wrong." });
            //return new Error(error);
        }
    },

    getSellPhysicalTickets: async function (req, res) {
        try {
            let ticketData = [];
            let agentHall, agentHallId, hallDetails, agentHallNumber, createrId;
            const sessionDetails = req.session.details;
            createrId = sessionDetails?.id;
            if (sessionDetails?.is_admin === "no" && sessionDetails?.id) {
                agentHall = sessionDetails?.hall?.[0]?.name;
                agentHallId = sessionDetails?.hall?.[0]?.id;
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: agentHallId }, 
                    ["number"]
                );
            } else if (sessionDetails?.is_admin === "yes" && req.query.hallId && sessionDetails?.id) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: req.query.hallId }, 
                    ["name", "number"]
                );
                agentHall = hallDetails.name;
                agentHallId = req.query.hallId;
                createrId = req.query.agentId;
            }

            agentHallNumber = hallDetails?.number;

            if (agentHallId && agentHall && agentHallNumber && createrId && req.params.gameId != "null") {

                let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentSellPhysicalTicketData({ hallId: agentHallId, hallNumber: agentHallNumber, agentId: createrId, gameId: req.params.gameId }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                if (registeredTickets && registeredTickets.allRange.length > 0) {
                    if (registeredTickets.allRange.length > 0) {
                        for (let i = 0; i < registeredTickets.allRange.length; i++) {
                            ticketData.push({
                                "id": registeredTickets.allRange[i].id,
                                "ticketColor": registeredTickets.allRange[i].ticketColor,
                                "initialId": registeredTickets.allRange[i].ticketIds[0],
                                "finalId": registeredTickets.allRange[i].ticketIds[registeredTickets.allRange[i].ticketIds.length - 1],
                            });
                        }
                    }
                }
            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketData.length,
                'recordsFiltered': ticketData.length,
                'data': ticketData,
            };
            res.send(obj);
        } catch (error) {
            Sys.Log.error('Error in getSellPhysicalTickets: ', error);
            return new Error(error);
        }
    },

    deleteSellPhysicalTicket: async function (req, res) {
        try {
            console.log("req.query", req.body, req.params, req.session.details)

            let agentHall, agentHallId, hallDetails, agentHallNumber, createrId;
            const sessionDetails = req.session.details;
            createrId = sessionDetails?.id;
            if (sessionDetails?.is_admin === "no" && sessionDetails?.id) {
                agentHall = sessionDetails?.hall?.[0]?.name;
                agentHallId = sessionDetails?.hall?.[0]?.id;
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: agentHallId }, 
                    ["number"]
                );
            } else if (sessionDetails?.is_admin === "yes" && req.query.hallId && sessionDetails?.id) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: req.query.hallId }, 
                    ["name", "number"]
                );
                agentHall = hallDetails.name;
                agentHallId = req.query.hallId;
                createrId = req.body.agentId;
            }

            agentHallNumber = hallDetails?.number;

            if (agentHallId && agentHall && agentHallNumber && createrId) {
                let sellingTickets = await Sys.App.Services.scheduleServices.getSingleAgentSellPhysicalTicketData({ hallId: agentHallId, hallNumber: agentHallNumber, agentId: createrId, gameId: req.body.gameId }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                console.log("registeredTickets---", sellingTickets)
                if (sellingTickets && sellingTickets.allRange.length > 0) {
                    let isColor = sellingTickets.allRange.findIndex((e) => e.id == req.body.id);
                    console.log("isColor", isColor)
                    if (isColor != -1) {
                        let updatedTicket = await Sys.App.Services.scheduleServices.updateAgentSellPhysicalTicketData({ hallId: agentHallId, hallNumber: agentHallNumber, agentId: createrId, gameId: req.body.gameId }, {
                            $pull: { "allRange": { "id": req.body.id } }
                        }, { new: true }
                        );
                        console.log("updated hall when same color data found", updatedTicket);

                        Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: agentHallId, hallNumber: agentHallNumber }, {
                            $pull: {
                                "allRange.$[current].soldTicketIDs": { $in: sellingTickets.allRange[isColor].ticketIds },
                                "allRange.$[current].holdTicketIds": { $in: sellingTickets.allRange[isColor].ticketIds }
                            }
                        }, { arrayFilters: [{ "current.ticketColor": sellingTickets.allRange[isColor].ticketColor }], new: true });

                        if (updatedTicket && updatedTicket.allRange.length == 0) {
                            // await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: req.body.gameId }, {
                            //     $set: {
                            //         "otherData.agents.$[current].scannedTickets.isScanned": false,
                            //         "otherData.agents.$[current].scannedTickets.isPending": false,
                            //     },
                            // }, { arrayFilters: [{ "current.id": mongoose.Types.ObjectId(createrId), "current.hallId": mongoose.Types.ObjectId(agentHallId) }], new: true })
                            
                            // if already sold then isScanned should be true
                            await Sys.Game.Game1.Services.GameServices.updateGameNested(
                                { _id: req.body.gameId },
                                [
                                    {
                                        $set: {
                                            "otherData.agents": {
                                                $map: {
                                                    input: "$otherData.agents",
                                                    as: "agent",
                                                    in: {
                                                        $cond: [
                                                            { $and: [
                                                                { $eq: ["$$agent.id", mongoose.Types.ObjectId(createrId)] },
                                                                { $eq: ["$$agent.hallId", mongoose.Types.ObjectId(agentHallId)] }
                                                            ] },
                                                            {
                                                                $mergeObjects: [
                                                                    "$$agent",
                                                                    {
                                                                        scannedTickets: {
                                                                            $mergeObjects: [
                                                                                "$$agent.scannedTickets",
                                                                                {
                                                                                    isScanned: { $cond: ["$$agent.scannedTickets.isSold", true, false] },
                                                                                    isPending: false,
                                                                                }
                                                                            ]
                                                                        }
                                                                    }
                                                                ]
                                                            },
                                                            "$$agent"
                                                        ]
                                                    }
                                                }
                                            }
                                        }
                                    }
                                ]
                            );
                            
                        }
                        Sys.App.Controllers.agentcashinoutController.setHallStausWithColorCode({ gameId: req.body.gameId });

                        return res.send("success");
                    } else {
                        return res.send("error");
                    }
                } else {
                    return res.send("error");
                }
            } else {
                return res.send("error");
            }

        } catch (error) {
            Sys.Log.error('Error in deleteSellPhysicalTicket: ', error);
            return new Error(error);
        }
    },

    deleteAllSellPhysicalTicket: async function (req, res) {
        try {
            let removeTickets = [];
            if (req.session.details && req.session.details.is_admin == "no" && req.session.details.id) {
                let agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: req.session.details.id }, ['hall']);
                let agentHall = req.session.details.hall[0].name;
                console.log("agentDetails---", agentDetails, agentHall, { hallId: req.session.details.hall[0].id, hallName: agentHall, agentId: agentDetails.id, gameId: req.body.gameId });
                if (agentDetails && agentHall) {
                    let hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                        { _id: req.session.details.hall[0].id }, 
                        ["number"]
                    );
                    let agentHallNumber = hallDetails?.number;
                    let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentSellPhysicalTicketData({ hallId: req.session.details.hall[0].id, hallNumber: agentHallNumber, agentId: agentDetails.id, gameId: req.body.gameId }, { hallId: 1, hallName: 1, allRange: 1, isAddedInSystem: 1 }, {});
                    console.log("registeredTickets--", registeredTickets)
                    if (registeredTickets && registeredTickets.allRange.length > 0) {
                        if (registeredTickets.isAddedInSystem == false) {
                            if (registeredTickets.allRange.length > 0) {
                                for (let i = 0; i < registeredTickets.allRange.length; i++) {
                                    removeTickets.push({
                                        ticketColor: registeredTickets.allRange[i].ticketColor,
                                        ticketIds: registeredTickets.allRange[i].ticketIds
                                    });
                                    Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: req.session.details.hall[0].id, hallNumber: agentHallNumber }, {
                                        $pull: {
                                            "allRange.$[current].soldTicketIDs": { $in: registeredTickets.allRange[i].ticketIds },
                                            "allRange.$[current].holdTicketIds": { $in: registeredTickets.allRange[i].ticketIds }
                                        }
                                    }, { arrayFilters: [{ "current.ticketColor": registeredTickets.allRange[i].ticketColor }], new: true });
                                }
                                await Sys.App.Services.scheduleServices.deleteAgentSellPhysicalTicket({ hallId: req.session.details.hall[0].id, hallNumber: agentHallNumber, agentId: agentDetails.id, gameId: req.body.gameId });

                                // await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: req.body.gameId }, {
                                //     $set: {
                                //         "otherData.agents.$[current].scannedTickets.isScanned": false,
                                //         "otherData.agents.$[current].scannedTickets.isPending": false,
                                //     },
                                // }, { arrayFilters: [{ "current.id": mongoose.Types.ObjectId(req.session.details.id), "current.hallId": mongoose.Types.ObjectId(req.session.details.hall[0].id) }], new: true })
                                
                                // if already sold then isScanned should be true
                                await Sys.Game.Game1.Services.GameServices.updateGameNested(
                                    { _id: req.body.gameId },
                                    [
                                        {
                                            $set: {
                                                "otherData.agents": {
                                                    $map: {
                                                        input: "$otherData.agents",
                                                        as: "agent",
                                                        in: {
                                                            $cond: [
                                                                { $and: [
                                                                    { $eq: ["$$agent.id", mongoose.Types.ObjectId(req.session.details.id)] },
                                                                    { $eq: ["$$agent.hallId", mongoose.Types.ObjectId(req.session.details.hall[0].id)] }
                                                                ] },
                                                                {
                                                                    $mergeObjects: [
                                                                        "$$agent",
                                                                        {
                                                                            scannedTickets: {
                                                                                $mergeObjects: [
                                                                                    "$$agent.scannedTickets",
                                                                                    {
                                                                                        isScanned: { $cond: ["$$agent.scannedTickets.isSold", true, false] },
                                                                                        isPending: false,
                                                                                    }
                                                                                ]
                                                                            }
                                                                        }
                                                                    ]
                                                                },
                                                                "$$agent"
                                                            ]
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                );
                                
                                Sys.App.Controllers.agentcashinoutController.setHallStausWithColorCode({ gameId: req.body.gameId });

                                return res.send("success");
                            }
                            console.log("removeTickets---", removeTickets)
                        }
                    }
                }
                return res.send("error");
            }
        } catch (e) {
            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language) }); // "Something went wrong." });
        }
    },

    getHallAgents: async function (req, res) {
        try {
            let agentsData = await Sys.App.Services.AgentServices.getAllAgentDataSelect({ hall: { $elemMatch: { "id": req.query.id } }, status: "active" }, ['name']);
            return res.send({ status: "success", agents: agentsData });
        } catch (error) {
            Sys.Log.error('Error in getHallAgents: ', error);
            return res.send({ status: "fail", agents: [] });
        }
    },


    purchasePhysicalTickets: async function (req, res) {
        try {
            console.log("purchase physical ticket called", req.body, req.params, req.query)
            let playerPurTickets = [];
            let { id: sessionId, name: sessionName, is_admin, hall, shiftId: sessionShiftId, language } = req.session.details || {};
            let { gameId, hallId: bodyHallId, agentId: bodyAgentId } = req.body;
    
            let agentHall, agentHallId, agentHallNumber, createrId = sessionId, createrName = sessionName, shiftId = sessionShiftId;
            
            // --- Determine hallId and creatorId based on admin/non-admin ---
            if (is_admin === "no" && sessionId) {
                agentHallId = hall?.[0]?.id;
                agentHall   = hall?.[0]?.name;
            } else if (is_admin === "yes" && sessionId && bodyHallId) {
                agentHallId = bodyHallId;
                createrId   = bodyAgentId;
                let agentDetails = await Sys.App.Services.AgentServices.getSingleAgentDataForRole(
                    { _id: createrId }, ["name"]
                );
                createrName = agentDetails?.name || createrName;
            } else {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
            }
    
            // --- Fetch hall details ---
            let hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                { _id: agentHallId },
                ["name", "activeAgents", "otherData.isPreviousDaySettlementPending", "number"]
            );
    
            if (!hallDetails) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
            }
            agentHallNumber = hallDetails.number;
            // --- Validate active agent ---
            const currentActiveAgent = hallDetails.activeAgents?.find(agent => agent.id === createrId);
            if (!hallDetails.activeAgents?.length || !currentActiveAgent) {
                const key = is_admin === "yes"
                    ? "selected_agent_is_not_active_in_the_hall_or_please_ensure_the_previous_agent_logs_out_before_selling_the_tickets"
                    : "this_agent_is_not_active_in_hall";
    
                return res.json({ 
                    status: "fail", 
                    message: await Sys.Helper.bingo.getSingleTraslateData([key], language) 
                });
            }
    
            // --- Check settlement status ---
            if (hallDetails.otherData?.isPreviousDaySettlementPending) {
                return res.json({ 
                    status: "fail", 
                    message: await Sys.Helper.bingo.getSingleTraslateData(
                        ["please_do_previous_day_settlement_before_selling_the_new_tickets"], language
                    ) 
                });
            }
    
            // --- Assign shiftId from active agent ---
            shiftId = (is_admin === "yes" && currentActiveAgent.shiftId) || shiftId;
            
            console.log(agentHallId, agentHall, createrId, req.body.gameId)
            if (agentHallId && agentHall && createrId) {
                let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentSellPhysicalTicketData(
                    { hallId: agentHallId, hallNumber: agentHallNumber, agentId: createrId, gameId },
                    { hallId: 1, hallName: 1, allRange: 1 },
                    {}
                );
            
                if (registeredTickets?.allRange?.length) {
                    registeredTickets.allRange.forEach(({ ticketColor, ticketIds }) => {
                        let index = playerPurTickets.findIndex(e => e.ticketName === ticketColor);
                        if (index !== -1) {
                            playerPurTickets[index].ticketIds.push(...ticketIds);
                        } else {
                            playerPurTickets.push({ ticketName: ticketColor, ticketIds });
                        }
                    });
                }
            }
            Sys.Log.info("playerPurTickets---", playerPurTickets);
            // playerPurTickets = playerPurTickets.map(ticket => ({
            //     ...ticket,
            //     ticketIds: ticket.ticketName.includes('Small')
            //       ? ticket.ticketIds.filter((_, i) => i % 5 === 0)
            //       : ticket.ticketIds
            // }));  
            // Sys.Log.info("playerPurTickets final result--",playerPurTickets);
            if (playerPurTickets.length > 0) {
                //Counting tickets for hall update
                const ticketFinalData = {};
                const ticketDetails = {};
                let gameData = await Sys.App.Services.GameService.getSingleGameData({ _id: gameId }, { graceDate: 1, startDate: 1, halls: 1, subGames: 1, gameName: 1, gameNumber: 1, players: 1, disableTicketPurchase: 1, parentGameId: 1, day: 1, stopGame: 1, status: 1, sequence: 1 });
                console.log("game data", gameData)
                if (!gameData) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["game_not_found"], req.session.details.language) }); // "Game Not Found." });
                } else {
                    if (gameData.status == "finish") { //gameData.status == "running" || 
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["game_already_finished"], req.session.details.language) }); // "Game already finished." });
                    }
                    // if (gameData.disableTicketPurchase == true) {
                    //     return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["ticket_purchase_has_been_disabled_for_this_game"], req.session.details.language) }); // "Ticket purchase has been disabled for this game." });
                    // }                                               
                    if (gameData.stopGame == true) {
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language) }); // "Something went wrong." });
                    }
                    let subgame = gameData.subGames[0].options;
                    if (subgame.length <= 0) {
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_not_found"], req.session.details.language) }); // "Tickets Not Found." });
                    }

                    let gameSelectedTicketColors = gameData.subGames[0].ticketColorTypes;
                    let agentRegisterdTickets = [];
                    let hallRegisteredTickets = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallId: agentHallId }, { allRange: 1 }, {});
                    if (hallRegisteredTickets && hallRegisteredTickets.allRange.length > 0) {
                        for (let i = 0; i < hallRegisteredTickets.allRange.length; i++) {
                            agentRegisterdTickets.push(hallRegisteredTickets.allRange[i].ticketColor);
                        }
                    }

                    // Filter the required tickets based on agent-registered tickets
                    let requiredTickets = gameData.gameName === "Traffic Light" 
                    ? ["traffic-light"] 
                    : gameSelectedTicketColors.filter(color => agentRegisterdTickets.includes(color));
                    Sys.Log.info("gameSelectedTicketColors, agentRegisterdTickets, requiredTickets and playerPurTickets ---", gameSelectedTicketColors, agentRegisterdTickets, requiredTickets, playerPurTickets);
                    
                    // Check if all required tickets are sold
                    const issoldAllTickets = requiredTickets.every(color =>
                        playerPurTickets.some(item => item.ticketName == color)
                    );
                    // Respond with a failure message if not all tickets are sold
                    if (issoldAllTickets == false) {
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_sell_all_registered_tickets"], req.session.details.language) }); // "Please Sell all Registered Tickets." });
                    }

                    // check player is allowed or not to play in defined halls
                    if (gameData.halls.length > 0) {
                        let playerHalls = [agentHallId.toString()];
                        let gameHalls = gameData.halls.map(function (item) {
                            return item.toString();
                        });
                        console.log("player approved halls", playerHalls, gameHalls)
                        const isHallmatched = playerHalls.some(r => gameHalls.includes(r));
                        console.log("isHallmatched", isHallmatched)
                        if (isHallmatched == false) {
                            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_purchase_tickets_in_this_hall"], req.session.details.language) }); // "You are not allowed to purchase tickets in this hall." });
                        }
                    }

                    // Get total ticket price from subgame tickets
                    let TotalAmountOfTickets = 0;
                    let ticketColorTypeArray = [];
                    let ticketQnty = 0;
                    let allTicketIdsToPurchase = [];

                    let isTicketsFound = false;
                    for (let p = 0; p < playerPurTickets.length; p++) {
                        if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName == "traffic-light") {
                            isTicketsFound = true;
                            let ticketCount = (playerPurTickets[p].ticketIds.length / 3);
                            if (parseInt(ticketCount) != ticketCount) {
                                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["traffic_light_tickets_should_be_in_multiple_of_3"], req.session.details.language) }); // "Traffic light tickets should be in multiple of 3." });
                            }
                            TotalAmountOfTickets += +subgame[0].ticketPrice * parseInt(ticketCount);
                            //let availableTrafficLightTickets = [];
                            for (let t = 0; t < subgame.length; t++) {
                                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId }, {
                                    $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': (parseInt(ticketCount)) }
                                }, { arrayFilters: [{ "o.ticketName": subgame[t].ticketName }], new: true });
                                //availableTrafficLightTickets.push(subgame[t].ticketName);
                            }
                            allTicketIdsToPurchase.push(...playerPurTickets[p].ticketIds);
                            ticketQnty = playerPurTickets[p].ticketIds.length;
                            ticketColorTypeArray.push({ ticketName: "traffic-light", price: subgame[0].ticketPrice, type: "traffic-light" })
            
                        } else {
                            const index = subgame.findIndex((e) => e.ticketName == playerPurTickets[p].ticketName);
                            if (index != -1) {
                                isTicketsFound = true;
                                console.log("subgame[s].ticketPrice & total tickets to purchase", playerPurTickets[p].ticketName, playerPurTickets[p].ticketIds.length);
                                let ticketCount = playerPurTickets[p].ticketIds.length;
                                console.log("update ticket count in subgames", ticketCount)
                                
                                if (playerPurTickets[p].ticketName.toLowerCase().includes('small')) {
                                    TotalAmountOfTickets += +subgame[index].ticketPrice * parseInt(ticketCount);
                                    ticketQnty = ticketQnty + parseInt(ticketCount);
                                    ticketColorTypeArray.push({ ticketName: playerPurTickets[p].ticketName, price: +subgame[index].ticketPrice, type: "small" })
                                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId }, {
                                        $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': parseInt(ticketCount) }
                                    }, { arrayFilters: [{ "o.ticketName": playerPurTickets[p].ticketName }], new: true });
                                } else if (playerPurTickets[p].ticketName.toLowerCase().includes('large')) {
                                    ticketCount = (playerPurTickets[p].ticketIds.length / 3);
                                    console.log("ticketCount----", ticketCount, playerPurTickets[p].ticketIds)
                                    if (parseInt(ticketCount) != ticketCount) {
                                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["large_tickets_should_be_in_multiple_of_3"], req.session.details.language) }); // "Large tickets should be in multiple of 3." });
                                    }
                                    ticketQnty = ticketQnty + parseInt(ticketCount * 3);
                                    TotalAmountOfTickets += +subgame[index].ticketPrice * parseInt(ticketCount);
                                    ticketColorTypeArray.push({ ticketName: playerPurTickets[p].ticketName, price: +subgame[index].ticketPrice, type: "large" })
                                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId }, {
                                        $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': parseInt(ticketCount) }
                                    }, { arrayFilters: [{ "o.ticketName": playerPurTickets[p].ticketName }], new: true });
                                }
                                allTicketIdsToPurchase.push(...playerPurTickets[p].ticketIds);
                            } else {
                                isTicketsFound = false;
                                break;
                            }
                        }

                    }
                    console.log("TotalAmountOfTickets, ticketColorTypeArray, ticketQnty ", TotalAmountOfTickets, ticketColorTypeArray, ticketQnty, allTicketIdsToPurchase)

                    if (isTicketsFound == false) {
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language) }); //"Something went wrong." });
                    }

                    //[ Normal Ticket Buying...!!! ] Update ticket to static collection and push ids
                    let finalDataTicketTemp = [];
                    const uniqueIdentifier = Date.now().toString(36) + Math.random().toString(36).substring(2) + createrId + gameData._id + ticketQnty;
                    let updateStaticPhysicaTicket = await Sys.App.Services.GameService.updateManyStaticPhysicalTickets(
                        { ticketId: { $in: allTicketIdsToPurchase }},
                        { $set: { isPurchased: true, playerIdOfPurchaser: createrId, gameId: gameData._id, uniqueIdentifier: uniqueIdentifier } },
                        { ordered: false }
                    );
                    console.log("physical ticket count--", updateStaticPhysicaTicket, uniqueIdentifier)
                    if(updateStaticPhysicaTicket.modifiedCount >= parseInt(ticketQnty) ){
                        finalDataTicketTemp = await Sys.App.Services.GameService.getStaticPhysicalTicketsByData({ ticketId: { $in: allTicketIdsToPurchase } }, { isPurchased: 1, tickets: 1, ticketId: 1, supplier: 1, ticketColor: 1, ticketType: 1 }, {});
                    }else{
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_not_available"], req.session.details.language) }); //"Tickets Not Available." });
                    }
                    
                    let userType = "Physical";
                    let playerTicketType = "Physical";

                    // Fetch groupOfHall and dailySchedule concurrently
                    let playerPurchasedTickets = [];
                    let ticketLargeArr = [];
                    let ticketDetails = {};  
                    let [groupOfHall, dailySchedule] = await Promise.all([
                        Sys.App.Services.GroupHallServices.getGroupHall(
                            { halls: { $elemMatch: { "id": agentHallId } } }, 
                            ['name']
                        ),
                        Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                            { _id: await Sys.Helper.bingo.obId(gameData.parentGameId) }, 
                            {}, {}
                        )
                    ]);

                   // Create a map for faster ticket type lookup
                    let ticketColorTypeMap = ticketColorTypeArray.reduce((map, obj) => {
                        map[obj.ticketName] = obj;
                        return map;
                    }, {});

                    console.log("finalDataTicketTemp & ticketQnty & ticketColorTypeArray", finalDataTicketTemp, ticketQnty, ticketColorTypeArray);

                    for (let r = 0; r < finalDataTicketTemp.length; r++) {
                        let { ticketType, ticketColor, ticketId, id, tickets, supplier } = finalDataTicketTemp[r];

                        let ticketColorType, ticketPrice;
                        
                        if (ticketType === "traffic-light") {
                            let colorMap = {
                                "Small Red": "traffic-red",
                                "Small Yellow": "traffic-yellow",
                                "Small Green": "traffic-green"
                            };
                            ticketColorType = colorMap[ticketColor] || null;
                            ticketPrice = ticketColorTypeMap["traffic-light"]?.price || 0;
                        } else {
                            let ticketData = ticketColorTypeMap[ticketColor] || {};
                            ticketColorType = ticketData.type || null;
                            ticketPrice = ticketData.price || 0;
                        }

                        // Modify ticket data
                        tickets[2][2] = { Number: 0, checked: true };

                        ticketLargeArr.push({
                            insertOne: {
                                document: {
                                    isAgentTicket: true,
                                    agentId: createrId,
                                    gameId: gameData._id,
                                    gameType: "game_1",
                                    gameName: gameData.gameName,
                                    ticketId,
                                    tickets,
                                    isPurchased: true,
                                    playerIdOfPurchaser: createrId,
                                    playerNameOfPurchaser: createrName,
                                    hallId: agentHallId,
                                    hallName: agentHall,
                                    groupHallId: groupOfHall._id,
                                    groupHallName: groupOfHall.name,
                                    ticketColorType,
                                    ticketColorName: ticketColor,
                                    ticketPrice,
                                    ticketParentId: id,
                                    userType,
                                    userTicketType: "Physical",
                                    ticketPurchasedFrom: 'cash',
                                    gameStartDate: gameData.startDate,
                                    uniquePlayerId: '',
                                    playerTicketType,
                                    supplier,
                                    developer: supplier,
                                    createdAt: Date.now(),
                                    dailyScheduleId: dailySchedule.dailyScheduleId,
                                    subGame1Id: dailySchedule.days[gameData.day][0],
                                    isPhysicalTicket: true,
                                    otherData: { shiftId, hallNumber: agentHallNumber }
                                }
                            }
                        });

                        let colorKey = ticketColor.split(' ').join('').toLowerCase();
                        ticketDetails[colorKey] = ticketDetails[colorKey] || { type: ticketColorType, count: 0 };
                        ticketDetails[colorKey].count++;
                    }

                    // Convert ticket counts
                    for (let key in ticketDetails) {
                        ticketFinalData[key] = ticketDetails[key].type === "large"
                            ? ticketDetails[key].count / 3
                            : ticketDetails[key].count;
                    }

                    // Fetch latestGame **AFTER** forming the ticket array
                    let latestGame = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                        { _id: gameData._id }, 
                        { disableTicketPurchase: 1, status: 1 }
                    );

                    // Check if ticket purchase is disabled
                    if (latestGame.status === "finish") {
                        return res.send({
                            status: "fail", 
                            message: await Sys.Helper.bingo.getSingleTraslateData(
                                ["game_already_finished"], 
                                req.session.details.language
                            )
                        });
                    }

                    // Insert tickets in bulk
                    let ticketInsert = await Sys.App.Services.GameService.bulkWriteTicketData(ticketLargeArr);
                    console.log("Inserted IDs:", ticketInsert.insertedIds);

                    if (ticketInsert.insertedIds) {
                        playerPurchasedTickets = Object.values(ticketInsert.insertedIds);
                    }
                    
                    const isPurchasedUpdated = gameData.players.findIndex((e) => e.id == createrId);
                    if (isPurchasedUpdated != -1) {
                        //let totalPurchasedTickets = (gameData.players[isPurchasedUpdated].totalPurchasedTickets + ticketQnty);
                        updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameData._id, 'players.id': gameData.players[isPurchasedUpdated].id },
                            {
                                $set: {
                                    'players.$.luckyNumber': 0,
                                },
                                $inc: {
                                    ticketSold: ticketQnty,
                                    earnedFromTickets: TotalAmountOfTickets,
                                    finalGameProfitAmount: TotalAmountOfTickets,
                                    'players.$.ticketPrice': TotalAmountOfTickets,
                                    'players.$.totalPurchasedTickets': ticketQnty,
                                }
                            },
                            { new: true }
                        );

                        let incObj = {};
                        let filterArr = [];
                        let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']

                        if (gameData.gameName == "Traffic Light") {
                            for (let s = 0; s < subgame.length; s++) {
                                incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = (ticketQnty / 3);
                                filterArr.push({ [tempAlpha[s] + ".ticketName"]: subgame[s].ticketName })
                            }
                        } else if (gameData.gameName == "Elvis") {
                            for (let s = 0; s < playerPurTickets.length; s++) {
                                incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = playerPurTickets[s].ticketIds.length;
                                filterArr.push({ [tempAlpha[s] + ".ticketName"]: playerPurTickets[s].ticketName })
                            }
                        } else {
                            for (let s = 0; s < playerPurTickets.length; s++) {
                                if (playerPurTickets[s].ticketName.toLowerCase().includes('large')) {
                                    incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = (playerPurTickets[s].ticketIds.length / 3);
                                } else {
                                    incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = playerPurTickets[s].ticketIds.length;
                                }

                                filterArr.push({ [tempAlpha[s] + ".ticketName"]: playerPurTickets[s].ticketName })
                            }
                        }


                        Object.entries(ticketFinalData).forEach(([key, value]) => {
                            incObj[`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = value
                            incObj[`groupHalls.$[group].halls.$[hall].userTicketType.Physical.${key}`] = value
                        });

                        filterArr.push({ "group.halls.id": agentHallId.toString() }, { "hall.id": agentHallId.toString() })


                        //console.log("update player tickets count", incObj, filterArr)
                        await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameData._id, 'players.id': createrId }, {
                            $inc: incObj
                        }, { arrayFilters: filterArr, new: true });


                    } else {
                        let purchaseTicketTypes = [];
                        for (let s = 0; s < subgame.length; s++) {
                            if (gameData.gameName == "Traffic Light") {
                                purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: (ticketQnty / 3) })
                            } else {
                                if (gameData.gameName == "Elvis") {
                                    //let purchaseCount = playerPurTickets.filter((obj) => obj.ticketName == subgame[s].ticketName).length;
                                    let purchaseCount = 0;
                                    let index = playerPurTickets.findIndex((e) => e.ticketName == subgame[s].ticketName);
                                    if (index != -1) {
                                        purchaseCount = playerPurTickets[index].ticketIds.length;
                                    }
                                    purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: purchaseCount })
                                } else {
                                    let purchaseCount = 0;
                                    let index = playerPurTickets.findIndex((e) => e.ticketName == subgame[s].ticketName);
                                    if (index != -1) {
                                        if (playerPurTickets[index].ticketName.toLowerCase().includes('large')) {
                                            purchaseCount = (playerPurTickets[index].ticketIds.length / 3);
                                        } else {
                                            purchaseCount = playerPurTickets[index].ticketIds.length;
                                        }
                                    }
                                    purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: purchaseCount })
                                }

                            }

                        }

                        let newPlayer = {
                            id: createrId,
                            name: createrName,
                            socketId: "",
                            totalPurchasedTickets: ticketQnty,
                            ticketPrice: TotalAmountOfTickets,
                            isPlayerOnline: false,
                            userType: userType,
                            luckyNumber: 0,
                            purchaseTicketTypes: purchaseTicketTypes,
                            purchasedSlug: 'cash',
                        }
                        const updateQuery = {
                            $push: { "players": newPlayer },
                            $inc: {
                                ticketSold: ticketQnty,
                                earnedFromTickets: TotalAmountOfTickets,
                                finalGameProfitAmount: TotalAmountOfTickets
                            }
                        }
                        Object.entries(ticketFinalData).forEach(([key, value]) => {
                            updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = value
                            updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].userTicketType.Physical.${key}`] = value
                        });
                        updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameData._id },
                            updateQuery,
                            {
                                arrayFilters: [{ "group.halls.id": agentHallId.toString() }, { "hall.id": agentHallId.toString() }],
                                new: true
                            }
                        );
                    }

                    let newExtraTransaction = {
                        playerId: createrId,
                        gameId: updatedGame._id,
                        transactionSlug: "extraTransaction",
                        typeOfTransaction: "Game Joined",
                        action: "credit", // debit / credit
                        purchasedSlug: 'cash', // point /realMoney/cash,
                        game1Slug: "buyTicket",
                        totalAmount: TotalAmountOfTickets,
                        hallId: agentHallId,
                        groupHallId: groupOfHall._id,
                        userType: "Agent",
                        hallName: agentHall,
                        groupHallName: groupOfHall?.name
                    }

                    Sys.Helper.gameHelper.createTransactionAgent(newExtraTransaction);

                    // add agent transaction 

                    console.log("This Agent [ ", createrName, " ] Tickets Purchased Successfully..!!");

                    // update ticketId for each ball and update tickets state for already drawn balls
                    const ticketsConfData = await Sys.Game.Game1.Controllers.GameController.setPurchasedTicketsIdBallWise(playerPurchasedTickets, gameData._id);
                    await Sys.Game.Game1.Controllers.GameController.processDrawnNumbers(gameData._id, ticketsConfData);
                    
                    if (gameData.gameName == "Spillerness Spill" || gameData.gameName == "Spillerness Spill 2" || gameData.gameName == "Spillerness Spill 3" || gameData.gameName == "Innsatsen") {
                        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('adminRefreshRoom', {});
                        let {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(gameData._id);
                        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('PatternChange', { patternList, jackPotData });
                    }
                    //let prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ _id: { $in: playerPurchasedTickets } }, { tickets: 1, gameId: 1, dailyScheduleId: 1, playerIdOfPurchaser: 1, ticketColorType: 1, ticketColorName: 1, ticketPrice: 1, userType: 1, ticketPurchasedFrom: 1 });
                    const transactionData = {
                        agentId: createrId,
                        agentName: createrName,
                        shiftId: shiftId,
                        hallId: agentHallId,
                        typeOfTransaction: "Physical Ticket Purchased.",
                        action: "credit",
                        totalAmount: TotalAmountOfTickets,
                        hallId: agentHallId,
                        groupHallId: groupOfHall._id,
                        hall: {
                            name: agentHall,
                            id: agentHallId.toString()
                        },
                        groupHall: {
                            id: groupOfHall._id.toString(),
                            name: groupOfHall.name
                        },
                        ticketData: finalDataTicketTemp.map(item => item.ticketId),// prTickets, // instead of all thicket object pass purchased ids
                        userType: "Physical",
                        paymentType: "Cash"
                    }
                    await Sys.Helper.gameHelper.physicalTicketTransactionsInHall(transactionData);

                    // remove sold tickets from hold
                    for (let r = 0; r < playerPurTickets.length; r++) {
                        await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: agentHallId, hallNumber: agentHallNumber }, {
                            $pull: {
                                "allRange.$[current].holdTicketIds": { $in: playerPurTickets[r].ticketIds }
                            }
                        }, { arrayFilters: [{ "current.ticketColor": playerPurTickets[r].ticketName }], new: true });
                    }
                    // remove sold tickets from hold

                    await Sys.App.Services.scheduleServices.deleteAgentSellPhysicalTicket({ hallId: agentHallId, hallNumber: agentHallNumber, agentId: createrId, gameId: gameId });
                    let dailyBalance = null
                    if (req.session.details.is_admin == "no") {
                        req.session.details.dailyBalance = Number(req.session.details.dailyBalance) + TotalAmountOfTickets;
                        dailyBalance = Number(req.session.details.dailyBalance) + TotalAmountOfTickets;
                    } else {
                        Sys.Helper.gameHelper.updateSession({ agentId: createrId, hallId: agentHallId, shiftId: shiftId })
                    }

                    const physicalTicketUpdatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId }, {
                        $set: {
                            "otherData.agents.$[current].scannedTickets.isSold": true,
                            "otherData.agents.$[current].scannedTickets.isPending": false,
                        },
                    }, { arrayFilters: [{ "current.id": mongoose.Types.ObjectId(createrId), "current.hallId": mongoose.Types.ObjectId(agentHallId) }], new: true })
                    Sys.App.Controllers.agentcashinoutController.setHallStausWithColorCode({ gameId: gameId });

                    gameData?.halls.forEach(hall => {
                        console.log("Call getTicketDataRefresh",);
                        Sys.Io.of('admin').to(hall).emit('getTicketDataRefresh', { message: "Ticket Purchase" });
                    })

                    // call checkForWinners if game is running for this newly added tickets
                    if(latestGame.status === "running"){
                        Sys.Game.Game1.Controllers.GameProcess.checkForWinners(gameData._id.toString(), physicalTicketUpdatedGame?.withdrawNumberArray?.at(-1) ?? null, null, playerPurchasedTickets)
                    }
                    req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["tickets_purchased_successfully"], req.session.details.language))//'Tickets Purchased Successfully.');
                    return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_purchased_successfully"], req.session.details.language), dailyBalance: dailyBalance }); //"Tickets Purchased Successfully.", dailyBalance: dailyBalance });

                }
            } else {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_ticket_ids_to_purchase"], req.session.details.language) }); //"Please provide ticket ids to purchase." });
            }

        } catch (error) {
            Sys.Log.error('Error in purchasePhysicalTickets: ', error);
            return res.send({ status: "fail" });
        }
    },


    // Edit physical ticket
    getEditRegisteredId: async function (req, res) {
        try {
            let agentHall, agentHallId, hallDetails, agentHallNumber;

            const sessionDetails = req.session.details;

            if (sessionDetails?.is_admin === "no" && sessionDetails?.id) {
                agentHall = sessionDetails?.hall?.[0]?.name;
                agentHallId = sessionDetails?.hall?.[0]?.id;
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: agentHallId }, 
                    ["number"]
                );
            } else if (sessionDetails?.is_admin === "yes" && req.query.hallId && sessionDetails?.id) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: req.query.hallId }, 
                    ["name", "number"]
                );
                agentHall = hallDetails.name;
                agentHallId = req.query.hallId;
            } else {
                return res.send({ status: "error" });
            }

            agentHallNumber = hallDetails?.number;

            if (agentHallId && agentHall && agentHallNumber) {
                let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallId: agentHallId, hallNumber: agentHallNumber }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                if (registeredTickets && registeredTickets.allRange.length > 0) {
                    let isColor = registeredTickets.allRange.findIndex((e) => e.id == req.query.id);
                    console.log("isColor", isColor)
                    if (isColor != -1) {
                        //console.log("edit ids", registeredTickets.allRange[isColor]);
                        let editInitialId = null;
                        if (registeredTickets.allRange[isColor].soldTicketIDs.length > 0) {
                            let tempEditInitialId = registeredTickets.allRange[isColor].soldTicketIDs[registeredTickets.allRange[isColor].soldTicketIDs.length - 1];
                            console.log("tempEditInitialId---", tempEditInitialId);
                            if (tempEditInitialId) {
                                // let array =  registeredTickets.allRange[isColor].ticketIds;
                                // let index = array.indexOf(tempEditInitialId);
                                // editInitialId = index !== -1 && index < array.length - 1 ? array[index + 1] : null;
                                // console.log("editInitialId---", editInitialId)

                                if (registeredTickets.allRange[isColor].ticketColor.toLowerCase().includes("small")) {
                                    editInitialId = +tempEditInitialId + 5;
                                }else{
                                    editInitialId = +tempEditInitialId + 1;
                                }
                                
                                if (editInitialId < registeredTickets.allRange[isColor].initialId) {
                                    editInitialId = registeredTickets.allRange[isColor].initialId;
                                }
                            }
                        }
                        if (!editInitialId) {
                            editInitialId = registeredTickets.allRange[isColor].ticketsAvailableFrom;
                        }
                        return res.send({ status: "success", editInitialId: editInitialId, editLastId: registeredTickets.allRange[isColor].finalId });
                    } else {
                        return res.send({ status: "error" });
                    }
                } else {
                    return res.send({ status: "error" });
                }
            } else {
                return res.send({ status: "error" });
            }

        } catch (error) {
            Sys.Log.error('Error in getEditRegisteredId: ', error);
            return new Error(error);
        }
    },

    editPhysicalTicketsPost: async function (req, res) {
        try {
            console.log("req.query", req.body, req.params, req.session.details)
            let initialId = +req.body.initialId;
            // let finalId = +req.body.finalId;
            // if (!finalId && initialId) {
            //     finalId = initialId + 99;
            // }
            // let agentHall, agentHallId, createrId = req.session.details.id;
            // if (!initialId || !finalId) {
            //     return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_ticket_id's"], req.session.details.language) }); //"Please provide ticket Id's." });
            // }
            // if (initialId > finalId) {
            //     return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["final_id_should_be_greater_than_initial_id"], req.session.details.language) }); //"Final Id Should be greater than Initial Id." });
            // }
            let agentHall, agentHallId, hallDetails, agentHallNumber, createrId;

            const sessionDetails = req.session.details;
            createrId = sessionDetails?.id;
            if (sessionDetails?.is_admin === "no" && sessionDetails?.id) {
                agentHall = sessionDetails?.hall?.[0]?.name;
                agentHallId = sessionDetails?.hall?.[0]?.id;
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: agentHallId }, 
                    ["number"]
                );
            } else if (sessionDetails?.is_admin === "yes" && req.body.hallId && sessionDetails?.id) {
                hallDetails = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: req.body.hallId }, 
                    ["name", "number"]
                );
                agentHall = hallDetails.name;
                agentHallId = req.body.hallId;
            } else {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["agent_not_found"], req.session.details.language) }); //"Agent Not Found." });
            }

            agentHallNumber = hallDetails?.number;

            if (agentHallId && agentHall && agentHallNumber) {
                let ticketIdArray = [];

                let ticketColorData = await Sys.App.Services.GameService.getSingleStaticPhysicalTicketsByData({ ticketId: initialId, hallNumber: agentHallNumber }, { ticketColor: 1, ticketType: 1 });
                console.log("ticketColor---", ticketColorData);
                if (!ticketColorData) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["tickets_data_not_found"], req.session.details.language) }); //"Tickets Data Not Found." });
                }

                //let finalId = +req.body.finalId || (ticketColorData.ticketType !== "traffic-light" && ticketColorData.ticketColor.toLowerCase().includes("small") ? initialId + (100 - 1) * 5 : initialId + 99);
                let finalId =
                    +req.body.finalId ||
                    (ticketColorData.ticketType === "traffic-light" || ticketColorData.ticketColor.toLowerCase().includes("large")
                        ? initialId + 299
                        : ticketColorData.ticketColor.toLowerCase().includes("small")
                        ? initialId + (100 - 1) * 5
                        : initialId + 99);
                        
                if (!initialId || !finalId) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_ticket_id's"], req.session.details.language) }); //"Please provide ticket Id's." });
                }

                if (initialId > finalId) {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["final_id_should_be_greater_than_initial_id"], req.session.details.language) }); //"Final Id Should be greater than Initial Id." });
                }

                if (ticketColorData.ticketType != "traffic-light" && ticketColorData.ticketColor.toLowerCase().includes("small")) {
                    for (let i = initialId; i <= finalId; i += 5) ticketIdArray.push(i.toString());
                }else{
                    for (let i = initialId; i <= finalId; i++) ticketIdArray.push(i.toString());
                }
                console.log("ticketIdArray----", ticketIdArray)
                let ticketCount = ticketIdArray.length;
                
                // if (ticketColorData.ticketType == "traffic-light") { //if(traficLightColors.includes(ticketColorData.ticketColor) == true ){
                //     //count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ ticketId: {$in: ticketIdArray}, hallName: agentHall, ticketType: "traffic-light" });
                //     count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ $and: [{ $expr: { $gte: [{ $toDouble: "$ticketId" }, +initialId] } }, { $expr: { $lte: [{ $toDouble: "$ticketId" }, +finalId] } }], hallName: agentHall, ticketType: "traffic-light" });
                // } else {
                //     count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount({ $and: [{ $expr: { $gte: [{ $toDouble: "$ticketId" }, +initialId] } }, { $expr: { $lte: [{ $toDouble: "$ticketId" }, +finalId] } }], hallName: agentHall, ticketColor: ticketColorData.ticketColor });
                // }
                
                let count = 0;

                // Prepare the base query object
                const query = {
                    hallNumber: agentHallNumber, //hallName: agentHall
                    ticketId: { $in: ticketIdArray } // Use $in with the array of ticket IDs
                };

                // Add conditions based on ticket type
                if (ticketColorData.ticketType === "traffic-light") {
                    query.ticketType = "traffic-light"; // Add ticketType for traffic-light
                } else {
                    query.ticketColor = ticketColorData.ticketColor; // Add ticketColor for other types
                }

                // Execute the count query
                count = await Sys.App.Services.GameService.getStaticPhysicalTicketCount(query);
                
                console.log("count--", count, { hallName: agentHall, ticketColor: ticketColorData.ticketColor })
                if (ticketCount == count) {
                    // add this range of tickets
                    let registeredTickets = await Sys.App.Services.scheduleServices.getSingleAgentRegisteredTicketData({ hallId: agentHallId }, { hallId: 1, hallName: 1, allRange: 1 }, {});
                    if (registeredTickets) {


                        console.log(" registeredTickets of hall ", registeredTickets, initialId, finalId);
                        let searchTicketColor = (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor;
                        console.log("searchTicketColor---", searchTicketColor, ticketColorData.ticketColor)

                        let isColor = registeredTickets.allRange.findIndex((e) => e.ticketColor == searchTicketColor);
                        console.log("isColor--", isColor)
                        if (isColor != -1) {
                            console.log("ticketColorData.ticketColor and original color", ticketColorData.ticketColor, registeredTickets.allRange[isColor].ticketColor)
                            if (req.body.editColorId != registeredTickets.allRange[isColor].id) {
                                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_valid_rang_of_ticket_Ids"], req.session.details.language) }); //"Please provide valid range of ticket Ids." });
                            }
                            // same color is already present so replace previous details
                            //let ticketsAvailableFrom = +registeredTickets.allRange[isColor].ticketsAvailableFrom
                            console.log("edit ids", registeredTickets.allRange[isColor]);
                            let ticketsAvailableFrom = null;
                            if (registeredTickets.allRange[isColor].soldTicketIDs.length > 0) {
                                let tempEditInitialId = registeredTickets.allRange[isColor].soldTicketIDs[registeredTickets.allRange[isColor].soldTicketIDs.length - 1];
                                console.log("tempEditInitialId---", tempEditInitialId);
                                if (tempEditInitialId) {
                                    // let array =  registeredTickets.allRange[isColor].ticketIds;
                                    // let index = array.indexOf(tempEditInitialId);
                                    // ticketsAvailableFrom = index !== -1 && index < array.length - 1 ? array[index + 1] : null;
                                    // console.log("editInitialId---", ticketsAvailableFrom)

                                    if (registeredTickets.allRange[isColor].ticketColor.toLowerCase().includes("small")) {
                                        ticketsAvailableFrom = +tempEditInitialId + 5;
                                    }else{
                                        ticketsAvailableFrom = +tempEditInitialId + 1;
                                    }

                                }
                            }

                            if (!ticketsAvailableFrom) {
                                ticketsAvailableFrom = +registeredTickets.allRange[isColor].ticketsAvailableFrom;
                            }

                            if (registeredTickets.allRange[isColor].soldTicketIDs.length > 0 && initialId < ticketsAvailableFrom) {
                                return res.send({ status: "fail", message: `${await Sys.Helper.bingo.getSingleTraslateData(["initial_id_should_be_greater_or_equals_to"], req.session.details.language)}  ${ticketsAvailableFrom}` }); //"Initial Id should be greater or equals to " + ticketsAvailableFrom });
                            }
                            let previousFinalID = +registeredTickets.allRange[isColor].finalId;
                            let currentInitialId = initialId;
                            console.log("previous final id", +previousFinalID, currentInitialId)
                            let isTicketsInTrack = false;


                            let ticketIdsArray = registeredTickets.allRange[isColor].ticketIds;
                            let rangeData = {
                                id: (+new Date()).toString(),
                                ticketColor: (ticketColorData.ticketType == "traffic-light") ? "traffic-light" : ticketColorData.ticketColor,
                                initialId: initialId,
                                finalId: finalId,
                                ticketsAvailableFrom: initialId,
                                //ticketIds: ticketIdArray,
                                agentId: createrId,
                                lastUpdatedDate: new Date()
                            }
                            // if( initialId == ticketsAvailableFrom){console.log("same initial id")
                            //     if(finalId >= previousFinalID){
                            //         if(finalId > previousFinalID){
                            //             ticketIdsArray = await addNumberRange(ticketIdsArray, (previousFinalID+1), finalId);
                            //             console.log("ticketIdsArray 1", ticketIdsArray, (previousFinalID+1), finalId)
                            //         }
                            //     }else {
                            //         ticketIdsArray = await removeNumberRange(ticketIdsArray, (finalId + 1), previousFinalID);
                            //         console.log("ticketIdsArray 2", ticketIdsArray, (finalId + 1), previousFinalID)
                            //     }
                            //     isTicketsInTrack = true;
                            // }else if(initialId > ticketsAvailableFrom){console.log("initial id is greater than ticket available")
                            //     ticketIdsArray = await removeNumberRange(ticketIdsArray, ticketsAvailableFrom, previousFinalID);
                            //     console.log("ticketIdsArray 3", ticketIdsArray, ticketsAvailableFrom, previousFinalID)
                            //     ticketIdsArray = await addNumberRange(ticketIdsArray, initialId, finalId);
                            //     console.log("ticketIdsArray 4", ticketIdsArray, initialId, finalId)
                            //     isTicketsInTrack = false;
                            // }

                            if (initialId == ticketsAvailableFrom) {
                                isTicketsInTrack = true;
                            } else {
                                isTicketsInTrack = false;
                            }
                            ticketIdsArray = await removeNumberRange(ticketIdsArray, ticketsAvailableFrom, previousFinalID);

                            if (registeredTickets.allRange[isColor].ticketColor.toLowerCase().includes("small")) {
                                ticketIdsArray.push(...ticketIdArray);
                            }else{
                                ticketIdsArray = await addNumberRange(ticketIdsArray, initialId, finalId);
                            }
                            
                            let updatedTickets = await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: agentHallId }, {
                                $set: {
                                    'allRange.$[current1].initialId': rangeData.initialId,
                                    'allRange.$[current1].finalId': rangeData.finalId,
                                    'allRange.$[current1].ticketsAvailableFrom': rangeData.ticketsAvailableFrom,
                                    'allRange.$[current1].lastUpdatedDate': rangeData.lastUpdatedDate,
                                    'allRange.$[current1].isTicketsInTrack': isTicketsInTrack,
                                    'allRange.$[current1].agentId': rangeData.agentId,
                                    'allRange.$[current1].ticketIds': ticketIdsArray
                                },

                            }, { arrayFilters: [{ "current1.ticketColor": searchTicketColor }], new: true }
                            );
                            console.log("updated Agent when same color data found", updatedTickets)

                        } else {
                            // color is not present
                            return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["ticket_type_is_different"], req.session.details.language) }); //"Ticket Type is different." });
                        }

                    } else {
                        return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_valid_rang_of_ticket_Ids"], req.session.details.language) }); //"Please provide valid range of ticket Ids." });
                    }
                    return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["data_updated_successfully"], req.session.details.language) }); //"Data Updated Successfully." });

                } else {
                    return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_provide_valid_rang_of_ticket_Ids"], req.session.details.language) }); //"Please provide valid range of ticket Ids." });
                }
                

            } else {
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["agent_not_found"], req.session.details.language) }); //"Agent Not Found." });
            }

        } catch (error) {
            Sys.Log.error('Error in edit PhysicalTickets: ', error);
            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language) }); //"Something went wrong." });
            //return new Error(error);
        }
    },

    deleteholdSellTicketsOfGame: async function (gameId) {
        try {
            let registeredTickets = await Sys.App.Services.scheduleServices.getAgentSellPhysicalTicketByData({ gameId: gameId }, { hallId: 1, hallName: 1, allRange: 1, isAddedInSystem: 1 }, {});

            if (registeredTickets && registeredTickets.length > 0) {
                for (let r = 0; r < registeredTickets.length; r++) {

                    if (registeredTickets[r].isAddedInSystem == false) {
                        if (registeredTickets[r].allRange.length > 0) {
                            for (let i = 0; i < registeredTickets[r].allRange.length; i++) {
                                await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: registeredTickets[r].hallId, hallNumber: registeredTickets[r].hallNumber }, {
                                    $pull: {
                                        "allRange.$[current].soldTicketIDs": { $in: registeredTickets[r].allRange[i].ticketIds },
                                        "allRange.$[current].holdTicketIds": { $in: registeredTickets[r].allRange[i].ticketIds }
                                    }
                                }, { arrayFilters: [{ "current.ticketColor": registeredTickets[r].allRange[i].ticketColor }], new: true });
                            }
                        }
                    }

                    await Sys.App.Services.scheduleServices.deleteAgentSellPhysicalTicket({ hallId: registeredTickets[r].hallId, hallNumber: registeredTickets[r].hallNumber, gameId: gameId });
                }
                return { status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["hold_tickets_deleted_successfully"], "english") }; //"hold Tickets deleted successfully." }
            } else {
                console.log("No hold tickets found");
                return { status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["no_hold_tickets_found"], "english") }; //"No hold tickets found" };
            }

        } catch (e) {
            return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], "english") }; //"Something went wrong." });
        }
    },

    deleteholdSellTicketsOfAgent: async function (req, res) {
        try {
            let registeredTickets = await Sys.App.Services.scheduleServices.getAgentSellPhysicalTicketByData({ hallId: req.session.details.hall[0].id, agentId: req.session.details.id }, { hallId: 1, hallName: 1, allRange: 1, isAddedInSystem: 1 }, {});
            console.log("registeredTickets of agent log out", registeredTickets)
            if (registeredTickets && registeredTickets.length > 0) {
                for (let r = 0; r < registeredTickets.length; r++) {

                    if (registeredTickets[r].isAddedInSystem == false) {
                        if (registeredTickets[r].allRange.length > 0) {
                            for (let i = 0; i < registeredTickets[r].allRange.length; i++) {
                                await Sys.App.Services.scheduleServices.updateAgentRegisteredTicketData({ hallId: registeredTickets[r].hallId, hallNumber: registeredTickets[r].hallNumber }, {
                                    $pull: {
                                        "allRange.$[current].soldTicketIDs": { $in: registeredTickets[r].allRange[i].ticketIds },
                                        "allRange.$[current].holdTicketIds": { $in: registeredTickets[r].allRange[i].ticketIds }
                                    }
                                }, { arrayFilters: [{ "current.ticketColor": registeredTickets[r].allRange[i].ticketColor }], new: true });
                            }
                        }
                    }

                    await Sys.App.Services.scheduleServices.deleteAgentSellPhysicalTicket({ hallId: registeredTickets[r].hallId, agentId: req.session.details.id });
                }
                return { status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["hold_tickets_deleted_successfully"], req.session.details.language) }; //"hold Tickets deleted successfully." }
            } else {
                console.log("No hold tickets found");
                return { status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["no_hold_tickets_found"], req.session.details.language) }; //"No hold tickets found" };
            }
        } catch (e) {
            console.log("Error in deleting agents sell tickets", e)
        }
    }

}

async function removeNumberRange(arr, start, end) {
    // Filter the array to exclude numbers within the specified range (as strings)
    const filteredArr = arr.filter(num => {
        const numInt = parseInt(num, 10);
        return numInt < start || numInt > end;
    });

    return filteredArr;
}

// Function to add a range of numbers to an array if they are not already present
async function addNumberRange(arr, start, end) {
    let newArr = [...arr]; // Copy of the original array
    for (let i = start; i <= end; i++) {
        const numStr = i.toString();
        if (!newArr.includes(numStr)) {
            newArr.push(numStr);
        }
    }
    return newArr;
}