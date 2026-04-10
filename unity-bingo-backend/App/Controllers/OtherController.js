var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');
module.exports = {


    miniGame: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                otherModules: 'active',
                translate: translate,
                navigation: translate
            };
            return res.render('otherModules/MiniGame', data);
        } catch (error) {
            Sys.Log.error('Error in miniGame: ', error);
            return new Error(error);
        }
    },

    background: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                otherModules: 'active',
                translate: translate,
                navigation: translate
            };
            return res.render('otherModules/background', data);
        } catch (error) {
            Sys.Log.error('Error in background: ', error);
            return new Error(error);
        }
    },

    getBackground: async function (req, res) {
        try {
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                query = { name: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.OtherModules.getBackgroundCount(query);

            let data = await Sys.App.Services.OtherModules.getBackgroundDatatable(query, length, start);

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

    addBackground: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                backgroundActive: 'active',
                translate: translate,
                navigation: translate
            };
            return res.render('otherModules/addBackground', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addBackgroundPostData: async function (req, res) {
        try {
            console.log('pattern: ', req.body);
            let fileName = '';
            if (req.files) {
                let image = req.files.avatar;
                var re = /(?:\.([^.]+))?$/;
                var ext = re.exec(image.name)[1];
                fileName = Date.now() + '.' + ext;
                // Use the mv() method to place the file somewhere on your server
                image.mv('./public/profile/bingo/' + fileName, async function (err) {
                    if (err) {
                        req.flash('error'/await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_profile_avatar"], req.session.details.language))//Error Uploading Profile Avatar
                        return res.redirect('/background');
                    }
                    let game = await Sys.App.Services.OtherModules.insertBackgroundData({
                        name: req.body.name,
                        price: req.body.price,
                        photo: fileName,
                        isDefault: true
                    });
                    req.flash('success',await Sys.Helper.bingo.getSingleTraslateData(["background_create_successfully"], req.session.details.language))//'Background create successfully'
                    return res.redirect('/background');
                });
            } else {
                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["background_not_created"], req.session.details.language)) //'Background Not Created');
                
                return res.redirect('/background');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    editBackground: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let query = { _id: req.params.id };
            let background = await Sys.App.Services.OtherModules.getSingleBackgroundData(query);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                backgroundActive: 'active',
                background: background,
                translate: translate,
                navigation: translate
            };
            return res.render('otherModules/addBackground', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editBackgroundPostData: async function (req, res) {
        try {
            let UpdateBackgroundTwo = await Sys.App.Services.OtherModules.getSingleBackgroundData({ _id: req.params.id });
            console.log('pattern: ', req.body);
            if (UpdateBackgroundTwo != undefined) {
                let pattern = (req.body.pattern == 'on') ? true : false;
                if (req.files && req.files.avatar && req.files.avatar.name) {
                    let image = req.files.avatar;
                    var re = /(?:\.([^.]+))?$/;
                    var ext = re.exec(image.name)[1];
                    fileName = Date.now() + '.' + ext;
                    // Use the mv() method to place the file somewhere on your server
                    image.mv('./public/profile/bingo/' + fileName, async function (err) {
                        if (err) {
                            req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_profile_avatar"], req.session.details.language)) //'Error Uploading Profile Avatar');
                            return res.redirect('/background');
                        }
                        let game = await Sys.App.Services.OtherModules.updateBackgroundData({
                            _id: req.params.id
                        }, {
                            name: req.body.name,
                            price: req.body.price,
                            photo: fileName,
                            isDefault: true
                        });
                        req.flash('success',await Sys.Helper.bingo.getSingleTraslateData(["background_Updated_successfully"], req.session.details.language)) //'Background Updated successfully');
                        return res.redirect('/background');
                    });
                } else {
                    let game = await Sys.App.Services.OtherModules.updateBackgroundData({
                        _id: req.params.id
                    }, {
                        name: req.body.name,
                        price: req.body.price
                    });
                    req.flash('success',await Sys.Helper.bingo.getSingleTraslateData(["background_updated_successfully"], req.session.details.language)) //'Background Updated successfully');
                    return res.redirect('/background');
                }
            } else {
                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["no_background_found"], req.session.details.language)) //'No Background found');
                return res.redirect('/background');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteBackground: async function (req, res) {
        try {
            let game = await Sys.App.Services.OtherModules.getSingleBackgroundData({ _id: req.body.id });
            if (game || game.length > 0) {
                await Sys.App.Services.OtherModules.deleteBackground(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewBackground: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let query = { _id: req.params.id };
            let background = await Sys.App.Services.OtherModules.getSingleBackgroundData(query);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                backgroundActive: 'active',
                background: background,
                translate: translate,
                navigation: translate
            };
            return res.render('background/view', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    // [ Theme ]
    theme: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let statusFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Other Modules'] || [];
                let stringReplace =req.session.details.isPermission['Other Modules'] || [];
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
                if (stringReplace?.indexOf("status") == -1) {
                    statusFlag = false;
                }
            }
            let theme = await Sys.App.Services.OtherModules.getSingleThemeData();

            let keys = [
                "theme",
                "dashboard",
                "android",
                "uploaded",
                "not_uploaded",
                "version",
                "versionAndroid",
                "ios",
                "versionIOS",
                "webgl",
                "versionWebGL",
                "submit",
                "cancel"
            ]

            let themes = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            console.log('theme: ', theme);
            let fl = (theme == null) ? false : true;
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                otherModules: 'active',
                themeCl: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                statusFlag: statusFlag,
                theme: theme,
                fl: fl,
                themes: themes,
                navigation: themes,
                
            };
            return res.render('otherModules/theme', data);
        } catch (error) {
            Sys.Log.error('Error in theme: ', error);
            return new Error(error);
        }
    },

    themeEdit: async function (req, res) {
        try {

            let theme = await Sys.App.Services.OtherModules.getSingleThemeData();

            let android = '';
            let ios = '';
            let webgl = '';

            if (theme == null) {

                let fileName = '';
                if (req.files) {
                    if (req.files.android) {
                        let image = req.files.android;
                        var re = /(?:\.([^.]+))?$/;
                        var ext = re.exec(image.name)[1];
                        fileName = Date.now() + '.' + ext;
                        image.mv('./public/theme/bingo/' + fileName, async function (err) {
                            if (err) {
                                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_android_theme"], req.session.details.language)) //'Error Uploading Android Theme');
                                return res.redirect('/theme');
                            }
                        });
                        android = (fileName == '') ? '' : '/theme/bingo/' + fileName;
                    }
                    if (req.files.ios) {
                        let image = req.files.ios;
                        var re = /(?:\.([^.]+))?$/;
                        var ext = re.exec(image.name)[1];
                        fileName = Date.now() + '.' + ext;
                        image.mv('./public/theme/bingo/' + fileName, async function (err) {
                            if (err) {
                                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_ios_theme"], req.session.details.language)) //'Error Uploading iOS Theme');
                                return res.redirect('/theme');
                            }
                        });
                        ios = (fileName == '') ? '' : '/theme/bingo/' + fileName;
                    }
                    if (req.files.webgl) {
                        let image = req.files.webgl;
                        var re = /(?:\.([^.]+))?$/;
                        var ext = re.exec(image.name)[1];
                        fileName = Date.now() + '.' + ext;
                        image.mv('./public/theme/bingo/' + fileName, async function (err) {
                            if (err) {
                                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_webgl_theme"], req.session.details.language)) //'Error Uploading WebGL Theme');
                                return res.redirect('/theme');
                            }
                        });
                        webgl = (fileName == '') ? '' : '/theme/bingo/' + fileName;
                    }

                }

                let data = {};
                if (android != '') {
                    data.android = android;
                    data.versionAndroid = 1;
                }
                if (ios != '') {
                    data.ios = ios;
                    data.versionIOS = 1;
                }
                if (webgl != '') {
                    data.webgl = webgl;
                    data.versionWebGL = 1;
                }

                await Sys.App.Services.OtherModules.insertData(data);
            } else {

                if (req.files) {
                    if (req.files.android) {
                        let image = req.files.android;
                        var re = /(?:\.([^.]+))?$/;
                        var ext = re.exec(image.name)[1];
                        let fileName = Date.now() + '.' + ext;
                        console.log('fileName: ', fileName);
                        image.mv('./public/theme/bingo/' + fileName, async function (err) {
                            if (err) {
                                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_android_theme"], req.session.details.language)) //'Error Uploading Android Theme');
                                return res.redirect('/theme');
                            }
                        });
                        android = (fileName == '') ? '' : '/theme/bingo/' + fileName;
                    }
                    if (req.files.ios) {
                        let image = req.files.ios;
                        var re = /(?:\.([^.]+))?$/;
                        var ext = re.exec(image.name)[1];
                        let fileName = Date.now() + '.' + ext;
                        image.mv('./public/theme/bingo/' + fileName, async function (err) {
                            if (err) {
                                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_ios_theme"], req.session.details.language)) //'Error Uploading iOS Theme');
                                return res.redirect('/theme');
                            }
                        });
                        ios = (fileName == '') ? '' : '/theme/bingo/' + fileName;
                    }
                    if (req.files.webgl) {
                        let image = req.files.webgl;
                        var re = /(?:\.([^.]+))?$/;
                        var ext = re.exec(image.name)[1];
                        let fileName = Date.now() + '.' + ext;
                        image.mv('./public/theme/bingo/' + fileName, async function (err) {
                            if (err) {
                                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_webgl_theme"], req.session.details.language)) //'Error Uploading WebGL Theme');
                                return res.redirect('/theme');
                            }
                        });
                        webgl = (fileName == '') ? '' : '/theme/bingo/' + fileName;
                    }

                }

                let data = {};
                if (android != '') {
                    data.android = android;
                    data.versionAndroid = theme.versionAndroid + 1;
                }
                if (ios != '') {
                    data.ios = ios;
                    data.versionIOS = theme.versionIOS + 1;
                }
                if (webgl != '') {
                    data.webgl = webgl;
                    data.versionWebGL = theme.versionWebGL + 1;
                }

                await Sys.App.Services.OtherModules.updateData({ _id: theme._id }, data)
            }

            req.flash('success',await Sys.Helper.bingo.getSingleTraslateData(["theme_updated_successfully"], req.session.details.language)) //'Theme updated successfully');
            return res.redirect('/theme')

        } catch (e) {
            console.log("Error", e);
        }
    },
    getTheme: async function (req, res) {
        try {
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                query = { name: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.OtherModules.getThemeCount(query);

            let data = await Sys.App.Services.OtherModules.getThemeDatatable(query, length, start);

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

    addTheme: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                themeActive: 'active',
                translate: translate,
                navigation: translate
            };
            return res.render('otherModules/addTheme', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addThemePostData: async function (req, res) {
        try {
            console.log('pattern: ', req.body);
            let fileName = '';
            if (req.files) {
                let image = req.files.avatar;
                var re = /(?:\.([^.]+))?$/;
                var ext = re.exec(image.name)[1];
                fileName = Date.now() + '.' + ext;
                // Use the mv() method to place the file somewhere on your server
                image.mv('./public/profile/bingo/' + fileName, async function (err) {
                    if (err) {
                        req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_profile_avatar"], req.session.details.language)) //'Error Uploading Profile Avatar');
                        return res.redirect('/theme');
                    }
                    let game = await Sys.App.Services.OtherModules.insertThemeData({
                        name: req.body.name,
                        price: req.body.price,
                        photo: fileName,
                        isDefault: true
                    });
                    req.flash('success',await Sys.Helper.bingo.getSingleTraslateData(["theme_create_successfully"], req.session.details.language)) //'Theme create successfully');
                    return res.redirect('/theme');
                });
            } else {
                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["theme_not_created"], req.session.details.language)) //'Theme Not Created');
                r
                return res.redirect('/theme');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    editTheme: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let query = { _id: req.params.id };
            let theme = await Sys.App.Services.OtherModules.getSingleThemeData(query);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                themeActive: 'active',
                theme: theme,
                translate: translate,
                navigation: translate
            };
            return res.render('otherModules/addTheme', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    editThemePostData: async function (req, res) {
        try {
            let UpdateThemeTwo = await Sys.App.Services.OtherModules.getSingleThemeData({ _id: req.params.id });
            console.log('pattern: ', req.body);
            if (UpdateThemeTwo != undefined) {
                let pattern = (req.body.pattern == 'on') ? true : false;
                if (req.files && req.files.avatar && req.files.avatar.name) {
                    let image = req.files.avatar;
                    var re = /(?:\.([^.]+))?$/;
                    var ext = re.exec(image.name)[1];
                    fileName = Date.now() + '.' + ext;
                    // Use the mv() method to place the file somewhere on your server
                    image.mv('./public/profile/bingo/' + fileName, async function (err) {
                        if (err) {
                            req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["error-uploading_profile_avatar"], req.session.details.language)) //'Error Uploading Profile Avatar');
                            return res.redirect('/theme');
                        }
                        let game = await Sys.App.Services.OtherModules.updateThemeData({
                            _id: req.params.id
                        }, {
                            name: req.body.name,
                            price: req.body.price,
                            photo: fileName,
                            isDefault: true
                        });
                        req.flash('success',await Sys.Helper.bingo.getSingleTraslateData(["theme_updated_successfully"], req.session.details.language)) //'Theme Updated successfully');
                        return res.redirect('/theme');
                    });
                } else {
                    let game = await Sys.App.Services.OtherModules.updateThemeData({
                        _id: req.params.id
                    }, {
                        name: req.body.name,
                        price: req.body.price
                    });
                    req.flash('success',await Sys.Helper.bingo.getSingleTraslateData(["theme_updated_successfully"], req.session.details.language)) //'Theme Updated successfully');
                    return res.redirect('/theme');
                }
            } else {
                req.flash('error',await Sys.Helper.bingo.getSingleTraslateData(["no_theme_found"], req.session.details.language)) //'No Theme found');
                return res.redirect('/theme');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteTheme: async function (req, res) {
        try {
            let game = await Sys.App.Services.OtherModules.getSingleThemeData({ _id: req.body.id });
            if (game || game.length > 0) {
                await Sys.App.Services.OtherModules.deleteTheme(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewTheme: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let query = { _id: req.params.id };
            let theme = await Sys.App.Services.OtherModules.getSingleThemeData(query);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                themeActive: 'active',
                theme: theme,
                translate: translate,
                navigation: translate
            };
            return res.render('background/view', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

}