var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
//const { query } = require('express');

module.exports = {
    cmsView: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let addFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['CMS Management'] || [];
                let stringReplace =req.session.details.isPermission['CMS Management'] || [];
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
                if (stringReplace?.indexOf("add") == -1) {
                    addFlag = false;
                }
            }
            let keys = [
                "cms_management",
                "dashboard",
                "cms",
                "sr_no",
                "cms_type",
                "action",
                "faq",
                "Terms_of_service",
                "support",
                "about_us",
                "responsible_gameing",
                "links_of_other_agencies"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                addFlag: addFlag,
                cmsM: cmsM,
                navigation: cmsM
            };

            let isDefaultCMS = null;
            isDefaultCMS = await Sys.App.Services.cmsServices.getByData({});

            if (isDefaultCMS == null || isDefaultCMS.length == 0) {
                let insertedUser = await Sys.App.Services.cmsServices.insertData({
                    terms: Sys.Config.App.defaultCMS.terms,
                    support: Sys.Config.App.defaultCMS.support,
                    aboutus: Sys.Config.App.defaultCMS.aboutus,
                    responsible_gameing: Sys.Config.App.defaultCMS.responsible_gameing,
                    links: Sys.Config.App.defaultCMS.links
                });
            }
            if(viewFlag){
                return res.render('CMS/cmsPage', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }
        } catch (e) {
            console.log("Error in cmsView", e);
            return new Error(e);
        }
    },

    faqView: async function (req, res) {
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
                // let stringReplace = user.permission['CMS Management'] || [];
                let stringReplace =req.session.details.isPermission['CMS Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['CMS Management'];
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
            let keys = [
                "faq_table",
                "dashboard",
                "faq",
                "faq_management",
                "add_faq",
                "question_id",
                "question",
                "answer",
                "action",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_player",
                "delete_button",
                "deleted",
                "your_imaginary_file_has_been_deleted",
                "something_went_wrong",
                "player_deleted_uccesfully",
                "cancelled",
                "player_not_deleted",
                "delete_player_message",
                "cancel_button",
                "faq_deleted_succesfully",
                "faq_not_deleted"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                cmsM: cmsM,
                navigation: cmsM
            };
            if(viewFlag){
                return res.render('CMS/faq', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }
        } catch (e) {
            console.log("Error in cmsView", e);
            return new Error(e);
        }
    },


    getFAQ: async function (req, res) {
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
                query = { queId: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.cmsServices.faqGetCount(query);

            let data = await Sys.App.Services.cmsServices.faqGetDatatable(query, length, start, sort);

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

    addFAQ: async function (req, res) {
        try {
            let keys = [
                "edit_faq",
                "add_faq",
                "dashboard",
                "faq",
                "question",
                "answer",
                "submit",
                "cancel"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                cmsM: cmsM,
                navigation: cmsM
            };
            return res.render('CMS/addFAQ', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addFAQPostData: async function (req, res) {
        try {
            //console.log("addHallPostData", req.body);


            let keys = ["faq_not_created", "faq_create_successfully"]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var ID = Date.now()
            var createID = dateTimeFunction(ID);


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
                let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes;
                return dateTime; // Function returns the dateandtime
            }

            let FAQ = await Sys.App.Services.cmsServices.faqInsertData({
                queId: createID + '_FAQ',
                question: req.body.question,
                answer: req.body.answer
            });

            if (!FAQ) {
                req.flash('error', cmsM.faq_not_created);
                return res.redirect('/faq');
            } else {
                req.flash('success', cmsM.faq_create_successfully);
                return res.redirect('/FAQ');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    editFAQ: async function (req, res) {
        try {


            let faq = await Sys.App.Services.cmsServices.faqGetById({ _id: req.params.id });
            let keys = [
                "edit_faq",
                "add_faq",
                "dashboard",
                "faq",
                "question",
                "answer",
                "submit",
                "cancel"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                FAQ: faq,
                cmsM: cmsM,
                navigation: cmsM
            };
            return res.render('CMS/addFAQ', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editFAQPostData: async function (req, res) {
        try {
            let keys = ["faq_updated_successfully", "no_faq_found"]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            faq = await Sys.App.Services.cmsServices.faqGetSingleData({ _id: req.params.id });

            if (faq != undefined) {
                let data = {
                    question: req.body.question,
                    answer: req.body.answer
                }

                await Sys.App.Services.cmsServices.faqUpdateData({ _id: req.params.id }, data)
                req.flash('success', cmsM.faq_updated_successfully);
                return res.redirect('/faq');
            } else {
                req.flash('error', "No FAQ found");
                return res.redirect('/faq');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },


    getFAQDelete: async function (req, res) {
        try {
            let player = await Sys.App.Services.cmsServices.faqGetSingleData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.cmsServices.faqDelete(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },


    TermsofServiceView: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['CMS Management'] || [];
                let stringReplace =req.session.details.isPermission['CMS Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            let keys = [
                "Terms_of_service",
                "dashboard",
                "submit",
                "cancel",
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let Term = await Sys.App.Services.cmsServices.getByData({});
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                Term: Term[0].terms,
                editFlag: editFlag,
                cmsM: cmsM,
                navigation: cmsM
            };
            return res.render('CMS/termsofservice', data);
        } catch (e) {
            console.log("Error in cmsView", e);
            return new Error(e);
        }
    },

    editTermPostData: async function (req, res) {
        try {
            let keys = [
                "terms_updated_successfully",
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let Term = await Sys.App.Services.cmsServices.getByData({});
            termUpdate = await Sys.App.Services.cmsServices.updateData({ _id: Term[0]._id }, {
                terms: {
                    title: "Terms & Condition",
                    description: req.body.answer,
                    slug: "terms_and_condition",
                }
            });
            console.log("Term ::::::::::::::::::", termUpdate);
            req.flash('success', cmsM.terms_updated_successfully) //'Terms updated successfully');
            return res.redirect('/TermsofService')

        } catch (e) {
            console.log("Error", e);
        }
    },

    SupportView: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['CMS Management'] || [];
                let stringReplace =req.session.details.isPermission['CMS Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            let keys = [
                "support",
                "dashboard",
                "submit",
                "cancel",
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let support = await Sys.App.Services.cmsServices.getByData({});
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                Support: support[0].support,
                editFlag: editFlag,
                cmsM: cmsM,
                navigation: cmsM
            };
            return res.render('CMS/support', data);
        } catch (e) {
            console.log("Error in cmsView", e);
            return new Error(e);
        }
    },


    editSupportPostData: async function (req, res) {
        try {
            let keys = [
                "support_data_updates_successfully",
                "support"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let support = await Sys.App.Services.cmsServices.getByData({});

            await Sys.App.Services.cmsServices.updateData({ _id: support[0]._id }, {
                support: {
                    title: "Support",
                    description: req.body.answer,
                    slug: "support",
                },
            });

            req.flash('success', cmsM.support_data_updates_successfully)// 'Support data updated successfully');
            return res.redirect('/Support')

        } catch (e) {
            console.log("Error", e);
        }
    },

    AboutusView: async function (req, res) {
        try {
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['CMS Management'] || [];
                let stringReplace =req.session.details.isPermission['CMS Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            let keys = [
                "about_us",
                "submit",
                "cancel",
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let Aboutus = await Sys.App.Services.cmsServices.getByData({});
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                Aboutus: Aboutus[0].aboutus,
                editFlag: editFlag,
                cmsM: cmsM,
                navigation: cmsM
            };
            return res.render('CMS/aboutus', data);
        } catch (e) {
            console.log("Error in cmsView", e);
            return new Error(e);
        }
    },

    editAboutPostData: async function (req, res) {
        try {

            let keys = [
                "aboutus_data_updated_successfully"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let Aboutus = await Sys.App.Services.cmsServices.getByData({});
            await Sys.App.Services.cmsServices.updateData({ _id: Aboutus[0]._id }, {
                aboutus: {
                    title: "About us",
                    description: req.body.answer,
                    slug: "about_us",
                },
            })
            req.flash('success', cmsM.aboutus_data_updated_successfully)//'Aboutus data updated successfully');
            return res.redirect('/Aboutus')

        } catch (e) {
            console.log("Error", e);
        }
    },

    ResponsibleGameingView: async function (req, res) {
        try {
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['CMS Management'] || [];
                let stringReplace =req.session.details.isPermission['CMS Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            let keys = [
                "responsible_gameing",
                "dashboard",
                "submit",
                "cancel"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let dataRG = await Sys.App.Services.cmsServices.getByData({});
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                data: dataRG[0].responsible_gameing,
                editFlag: editFlag,
                cmsM: cmsM,
                navigation: cmsM
            };
            return res.render('CMS/ResponsibleGameing', data);
        } catch (e) {
            console.log("Error in cmsView", e);
            return new Error(e);
        }
    },


    editResposibleGameingPostData: async function (req, res) {
        try {

            let keys = [
                "responsible_gameing_data_update_successfully"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let dataRG = await Sys.App.Services.cmsServices.getByData({});
            await Sys.App.Services.cmsServices.updateData({ _id: dataRG[0]._id }, {
                responsible_gameing: {
                    title: "Responsible - gameing",
                    description: req.body.answer,
                    slug: "responsible_gameing",
                },
            })
            req.flash('success', cmsM.responsible_gameing_data_update_successfully)// 'Responsible Gameing data updated successfully');
            return res.redirect('/ResponsibleGameing')
        } catch (e) {
            console.log("Error", e);
        }
    },


    LinksofOtherAgenciesView: async function (req, res) {
        try {
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['CMS Management'] || [];
                let stringReplace =req.session.details.isPermission['CMS Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            let keys = [
                "links_of_other_agencies",
                "dashboard",
                "submit",
                "cancel"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let dataLA = await Sys.App.Services.cmsServices.getByData({});
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                cmsActive: 'active',
                data: dataLA[0].links,
                editFlag: editFlag,
                cmsM: cmsM,
                navigation: cmsM
            };
            return res.render('CMS/LinksofOtherAgencies', data);
        } catch (e) {
            console.log("Error in cmsView", e);
            return new Error(e);
        }
    },

    editLinksofOtherAgenciesPostData: async function (req, res) {
        try {

            let keys = [
                "links_of_other_agencies_data_updated_successfully"
            ]
            let cmsM = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let dataLA = await Sys.App.Services.cmsServices.getByData({});
            await Sys.App.Services.cmsServices.updateData({ _id: dataLA[0]._id }, {
                links: {
                    title: "Links of Other Agencies",
                    description: req.body.answer,
                    slug: "links",
                }
            })
            req.flash('success', cmsM.links_of_other_agencies_data_updated_successfully )//'Links of Other Agencies data updated successfully');
            return res.redirect('/LinksofOtherAgencies')

        } catch (e) {
            console.log("Error", e);
        }
    },

    termsofService: async function(req, res){
        try{
            let cmsData = await Sys.App.Services.cmsServices.getSingleSelectedByData({}, {terms: 1});
            let termsData = null;
            
            if (cmsData && cmsData.terms) {
                termsData = cmsData.terms;
            }

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                termsData: termsData
            };
           
            return res.render('terms-of-service', data);
        }catch(e){
            console.log("something went wrong", e)
            return res.status(500).send("Internal Server Error");
        }
    }

}