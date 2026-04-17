var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var validate = require('express-validation');
var Joi = require('joi');
var back = require('express-back');
module.exports = {
    loginPostValidate: function(req, res, next) {
        //console.log('Validation check:', req.body);
        const rulesSchema = Joi.object({
            email: Joi.string().email().required(),
            password: Joi.string().regex(/[a-zA-Z0-9]{3,30}/).required()
        });
        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());
            res.redirect('/admin');
        } else {
            next();
        }
    },
    userChipsTransfer: function(req, res, next) {
        //console.log('Validation check:', req.body);
        const rulesSchema = Joi.object({
            userChips: Joi.string().required(),
            userChips: Joi.string().required(),
        });
        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());
            res.redirect('/admin');
        } else {
            next();
        }
    },
    registerUserPostValidate: function(req, res, next) {
        // console.log('Validation check:', req.body);
        const rulesSchema = Joi.object({
            username: Joi.string().alphanum().min(3).max(30).required(),
            status: Joi.string().min(3).max(30).required(),
            role: Joi.string().min(3).max(30).required(),
            email: Joi.string().email().required(),
            password: Joi.string().regex(/[a-zA-Z0-9]{3,30}/).required()
                // image: Joi.required()
        });

        const data = {
            username: 'abcd1234',
            status: 'abc1',
            role: 'Joe',
            email: 'not_a_valid_email_to_show_custom_label',
            password: '123456'
        };

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
            res.redirect('/addUser');
        } else {
            next();
        }
    },

    editUserPostValidate: function(req, res, next) {
        //console.log('Validation check:', req.body);
        const rulesSchema = Joi.object({
            username: Joi.string().alphanum().min(3).max(30).required(),
            status: Joi.string().min(3).max(30).required(),
            role: Joi.string().min(3).max(30).required(),
            // email: Joi.string().email().required(),
            // password: Joi.string().regex(/[a-zA-Z0-9]{3,30}/).required()
            // image: Joi
        });

        const data = {
            username: 'abcd1234',
            status: 'abc1',
            role: 'Joe',
            // email: 'not_a_valid_email_to_show_custom_label',
            password: '123456'
        };

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());   
            // console.log('ret.error', ret.error.toString());
            res.redirect('/user');
        } else {
            next();
        }
    },


    uniqueIdPostValidate: function(req, res, next) {
        //console.log('Validation check:', req.body);
        const rulesSchema = Joi.object({
            uipd_unique: Joi.string().required(),
            uied_unique: Joi.string().required(),
            balance_amount: Joi.string().required(),
            unique_validity: Joi.string().required(),
            ctimezone: Joi.string().required(),
            hall: Joi.string().optional().allow(null,''),
            paymentType: Joi.string().required(),
            agentId: Joi.string().optional().allow(null,''),
        });

       

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
          return res.send({status:'validate',message:ret.error})
        } else {
            next();
        }
    },

    /*** 
    
    Product and Category
    
    ***/
    addProductValidate: function (req, res, next) {
        console.log('addProductValidate Validation check:', req.body);
        const rulesSchema = Joi.object({
            productId: Joi.string().allow('').optional(),
            name: Joi.string().regex(/^[a-z\d\-_\s]+$/i).max(30).required(),
            price: Joi.number().required().precision(2),
            category: Joi.string().alphanum().required(),
            status: Joi.string().required().valid('active', 'inactive'),
            // image: Joi.required()
        });

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            // req.flash('error', ret.error.toString());
            req.flash('error', "Product Validation Failed,Please Provide Valid Details and Try Again!");
            // console.log('ret.error', ret.error.toString());
            return res.send('error');
        } else {
            next();
        }
    },

    editProductValidate: function (req, res, next) {
        console.log('addProductValidate Validation check:', req.body);
        const rulesSchema = Joi.object({
            productId: Joi.string().alphanum().required(),
            name: Joi.string().regex(/^[a-z\d\-_\s]+$/i).max(30).required(),
            price: Joi.number().required().precision(2),
            category: Joi.string().alphanum().required(),
            status: Joi.string().required().valid('active', 'inactive'),
            // image: Joi.required()
        });

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            console.log("Error", ret.error.toString());
            req.flash('error', "Edit Product Validation Failed,Please Provide Valid Details and Try Again!");
            return res.send('error');
        } else {
            next();
        }
    },

    addCategoryValidate: function (req,res,next) {
        console.log('categoryValidate Validation check:', req.body);
        const rulesSchema = Joi.object({
            categoryId: Joi.string().allow('').optional(),
            name: Joi.string().regex(/^[a-z\d\-_\s]+$/i).max(30).required(),
            status: Joi.string().required().valid('active', 'inactive')
        });

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            console.log("Error", ret.error.toString());
            req.flash('error', "Category Validation Failed,Please Provide Valid Details and Try Again!");
            return res.send('error');
        } else {
            next();
        }
    },

    editCategoryValidate: function (req, res, next) {
        console.log('categoryValidate Validation check:', req.body);
        const rulesSchema = Joi.object({
            categoryId: Joi.string().alphanum().required(),
            name: Joi.string().regex(/^[a-z\d\-_\s]+$/i).max(30).required(),
            status: Joi.string().required().valid('active', 'inactive')
        });

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            console.log("Error", ret.error.toString());
            req.flash('error', "Edit Category Validation Failed,Please Provide Valid Details and Try Again!");
            return res.send('error');
        } else {
            next();
        }
    },
    /***

    Player Validation
    ------------------

    ***/

    /* registerPlayerPostValidate: function(req, res, next){
         //console.log('Validation check:', req.body);
         const rulesSchema = Joi.object({
            username: Joi.string().alphanum().min(3).max(30).required(),
            password: Joi.string().regex(/[a-zA-Z0-9]{3,30}/).required(),
            firstname: Joi.string().alphanum().min(3).max(30).required(),
            lastname: Joi.string().alphanum().min(3).max(30).required(),
            email: Joi.string().email().required(),
            gender: Joi.string().required(),
            bot: Joi.string().required(),
            mobile: Joi.number().required(),
         });

         const ret = Joi.validate(req.body, rulesSchema, {
             allowUnknown: false,
             abortEarly: false
         });

         if (ret.error) {
             // res.status(400).end(ret.error.toString());
             console.log("Error",ret.error.toString());
             req.flash('error', ret.error.toString());
             // console.log('ret.error', ret.error.toString());
             res.redirect('/addPlayer');
         } else {
             next();
         }
     },*/

    registerPlayerPostValidate: function(req, res, next) {
        //console.log('Validation check:', req.body);
        console.log("registerPlayerPostValidate");

        const rulesSchema = Joi.object({
            firstname: Joi.string().alphanum().max(30).required(),
            lastname: Joi.string().alphanum().max(30).required(),
            mobile: Joi.number().required(),
            email: Joi.string().email().required(),
            username: Joi.string().alphanum().max(30).required(),
            password: Joi.string().regex(/[a-zA-Z0-9]{8,30}/).required(),
            confirm_password: Joi.string().regex(/[a-zA-Z0-9]{8,30}/).required(),
            //group: Joi.string().required(),
            // firstname: Joi.string().alphanum().max(30).required(),
            // lastname: Joi.string().alphanum().max(30).required(),
            // gender: Joi.string().required(),
            // bot: Joi.string().required(),
            // mobile: Joi.number().required(),
        });
        console.log(req.body);

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
            res.redirect('/addPlayer');
        } else {
            next();
        }
    },


    hallPostValidate: function(req, res, next) {
        console.log('Validation check:', req.body);
        //console.log("hallPostValidate", req.body);

        const hallSchema = Joi.object({
            hallName: Joi.string().max(22).required().label('Hall name'),
            hallNumber: Joi.number().required().label('Hall number'),
            ip: Joi.string().max(30).required().label('IP address'),
            address: Joi.string().max(150).required().label('Address'),
            City: Joi.string().max(30).required().label('City'),
            status: Joi.string().required().label('Status'),
        });


        const ret = Joi.validate(req.body, hallSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            const messages = ret.error.details.map(d => d.message.replace(/["]/g, ''));
            req.flash('error', messages.join(', '));
            const redirectPath = req.params && req.params.id ? `/hallEdit/${req.params.id}` : '/addHall';
            return res.redirect(redirectPath);
        } else {
            next();
        }
    },

    groupHallPostValidate: function(req, res, next) {
        //console.log('Validation check:', req.body);
        //console.log("hallPostValidate", req.body);

        const GroupHallSchema = Joi.object({
            name: Joi.string().max(30).required(),
            agentHalls: Joi,
            // agentname: Joi.string().alphanum().max(30).required(),
            agentname: Joi.string().max(150).required(),
            product: Joi.string().max(150).required(),
            status: Joi.string().required(),
        });


        const ret = Joi.validate(req.body, GroupHallSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error groupHallPostValidate", ret.error.toString());
            req.flash('error', ret.error.toString());
            console.log('ret.error', ret.error.toString());
            res.redirect('/addGroupHall');
        } else {
            next();
        }
    },


    gamePostValidate: function(req, res, next) {
        const gameTwoSchema = Joi.object({
            name: Joi.string().alphanum().max(30).required(),
            row: Joi.number().max(10).required(),
            columns: Joi.number().max(10).required(),
            totalNoTickets: Joi.number().required(),
            userMaxTickets: Joi.number().required(),
            rangeMin: Joi.number().max(100).required(),
            rangeMax: Joi.number().max(100).required(),
        });

        const ret = Joi.validate(req.body, gameTwoSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            console.log("Error gamePostValidate", ret.error.toString());
            req.flash('error', ret.error.toString());
            res.redirect('/gameTwo');
        } else {
            next();
        }
    },

    gameTwoPostValidate: function(req, res, next) {
        //console.log('gameTwoPostValidate Validation check:', req.body);
        const gameTwoSchema = Joi.object({
            start_date: Joi.date().required(),
            ticketPrice: Joi.number().required(),
            seconds: Joi.number().max(60).required(),
            priceNine: Joi.number().required(),
            priceTen: Joi.number().required(),
            priceEleven: Joi.number().required(),
            priceTwelve: Joi.number().required(),
            priceThirteen: Joi.number().required(),
            priceFourteenToTwentyone: Joi.number().required(),
            // row: Joi.number().max(10).required(),
            // columns: Joi.number().max(10).required(),
            // totalNoTickets: Joi.number().required(),
            // userMaxTickets: Joi.number().required(),
            // rangeMin: Joi.number().max(100).required(),
            // rangeMax: Joi.number().max(100).required(),
        });

        const ret = Joi.validate(req.body, gameTwoSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error gameTwoPostValidate", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
            res.redirect('/gameTwo');
        } else {
            next();
        }
    },

    gameThreePostValidate: function(req, res, next) {
        //console.log('gameTwoPostValidate Validation check:', req.body);
        const gameThreeSchema = Joi.object({
            start_date: Joi.date().required(),
            ticketPrice: Joi.number().required(),
            seconds: Joi.number().max(60).required(),
            // priceFive: Joi.number().required(),
            // priceTen: Joi.number().required(),
            // priceFifteen: Joi.number().required(),
            // priceTwenty: Joi.number().required(),
            // priceTwentyfive: Joi.number().required(),
            // priceThirty: Joi.number().required(),
            // priceThirtyA: Joi.number().required(),
            // priceThirtyfive: Joi.number().required(),
            // priceForty: Joi.number().required(),
            // priceThirtyfiveA: Joi.number().required(),
            // priceFortyA: Joi.number().required(),
            // priceFortyB: Joi.number().required(),
            // priceFortyfive: Joi.number().required(),
            // priceFortyfiveA: Joi.number().required(),
            // priceFortyeight: Joi.number().required(),
            // priceFortynine: Joi.number().required(),
            // priceFiftythree: Joi.number().required(),
            // priceSeventyfive: Joi.number().required(),
            // row: Joi.number().max(10).required(),
            // columns: Joi.number().max(10).required(),
            // totalNoTickets: Joi.number().required(),
            // userMaxTickets: Joi.number().required(),
            // rangeMin: Joi.number().max(100).required(),
            // rangeMax: Joi.number().max(100).required(),
        });

        const ret = Joi.validate(req.body, gameThreeSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error gameThreePostValidate", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
            res.redirect('/gameThree');
        } else {
            next();
        }
    },


    gameEditPostValidate: async function(req, res, next) {
        console.log("gameEditPostValidate", req.params);
        var gameType;
        if (req.params.slug == 'add') {
            gameType = await Sys.App.Services.GameService.getByIdGameTypeValidation({ _id: req.params.typeId });
        } {
            gameType = await Sys.App.Services.GameService.getByIdGameTypeValidation({ _id: req.params.typeId });
        }

        var gameSchema;
        if (gameType.type == "game_1") {

        } else if (gameType.type == "game_2") {
            if (req.body.gameMode == "auto") {
                gameSchema = Joi.object({
                    gameMode: Joi.string().required(),
                    start_date: Joi.date().required(),
                    minTicketCount: Joi.number().min(20).max(30).required(),
                    grace_time: Joi.date().required(),
                    ticketPrice: Joi.number().required(),
                    priceNine: Joi.number().required(),
                    priceTen: Joi.number().required(),
                    priceEleven: Joi.number().required(),
                    priceTwelve: Joi.number().required(),
                    priceThirteen: Joi.number().required(),
                    priceFourteenToTwentyone: Joi.number().required(),
                    totalNoTickets: Joi.number().required(),
                    notificationStartTime: Joi.string().required(),
                    luckyNumberPrize: Joi.number().required(),
                    seconds: Joi.number().required(),
                });
            } else if (req.body.gameMode == "manual") {
                req.body.minTicketCount = 20;
                req.body.grace_time = Date.now();
                gameSchema = Joi.object({
                    gameMode: Joi.string().required(),
                    start_date: Joi.date().required(),
                    minTicketCount: Joi.number().min(20).max(30).required(),
                    grace_time: Joi.date().required(),
                    ticketPrice: Joi.number().required(),
                    priceNine: Joi.number().required(),
                    priceTen: Joi.number().required(),
                    priceEleven: Joi.number().required(),
                    priceTwelve: Joi.number().required(),
                    priceThirteen: Joi.number().required(),
                    priceFourteenToTwentyone: Joi.number().required(),
                    totalNoTickets: Joi.number().required(),
                    notificationStartTime: Joi.string().required(),
                    luckyNumberPrize: Joi.number().required(),
                    seconds: Joi.number().required(),
                });
            } else {
                
            }
        } else if (gameType.type == "game_3") {
            if (req.body.gameMode == "auto") {
                gameSchema = Joi.object({
                    gameMode: Joi.string().required(),
                    start_date: Joi.date().required(),
                    minTicketCount: Joi.number().min(20).max(30).required(),
                    grace_time: Joi.date().required(),
                    ticketPrice: Joi.number().required(),
                    totalNoTickets: Joi.number().required(),
                    notificationStartTime: Joi.string().required(),
                    luckyNumberPrize: Joi.number().required(),
                    seconds: Joi.number().max(60).required(),
                });
            } else if (req.body.gameMode == "manual") {
                req.body.minTicketCount = 20;
                req.body.grace_time = Date.now();
                gameSchema = Joi.object({
                    gameMode: Joi.string().required(),
                    start_date: Joi.date().required(),
                    minTicketCount: Joi.number().min(20).max(30).required(),
                    grace_time: Joi.date().required(),
                    ticketPrice: Joi.number().required(),
                    totalNoTickets: Joi.number().required(),
                    notificationStartTime: Joi.string().required(),
                    luckyNumberPrize: Joi.number().required(),
                    seconds: Joi.number().max(60).required(),
                });
            }
        } else if (gameType.type == "game_4") {

        }

        const ret = Joi.validate(req.body, gameSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error gamePostValidate", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
            res.back();
        } else {
            next();
        }
    },

    editPlayerPostValidate: function(req, res, next) {
        //console.log('Validation check:', req.body);
        const rulesSchema = Joi.object({
            firstname: Joi.string().alphanum().max(30).required(),
            lastname: Joi.string().alphanum().max(30).required(),
            username: Joi.string().alphanum().max(30).required(),
            mobile: Joi.number().required(),
            email: Joi.string().email().required(),
            //group: Joi.string().required(),
        });

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
            res.redirect('/player');
        } else {
            next();
        }
    },

    // Setting Validation

    settingsValidation: function(req, res, next) {

        const rulesSchema = Joi.object({
            chips: Joi.number().required(),
            //defaultDiamonds: Joi.number().required(),
            //rackAmount: Joi.number().required(),
            //expireTime : Joi.required(),
            id: Joi
        });
        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: true,
            abortEarly: false
        });

        if (ret.error) {

            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());

            res.redirect('/settings');
        } else {
            next();
        }
    },

    // Groups validation

    addGroupsPostValidation: function(req, res, next) {
        const rulesSchema = Joi.object({
            name: Joi.string().required(),
            motto: Joi.string().required(),
            groupPassword: Joi.string().allow('', null),
            ownerId: Joi.string().required(),
            image: Joi.string().allow(''),
            ownerId: Joi.string().required(),
            groupPrivacy: Joi.string().required(),
            group_rules: Joi.string().allow(''),
            status: Joi.string().required(),
        });

        const ret = Joi.validate(req.body, rulesSchema, {
            allowUnknown: false,
            abortEarly: false
        });

        if (ret.error) {
            // res.status(400).end(ret.error.toString());
            console.log("Error", ret.error.toString());
            req.flash('error', ret.error.toString());
            // console.log('ret.error', ret.error.toString());
            res.redirect('/groups');
        } else {
            next();
        }
    },

}