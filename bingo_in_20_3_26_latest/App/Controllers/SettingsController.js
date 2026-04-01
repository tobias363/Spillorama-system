var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const pm2 = require('pm2');

module.exports = {
  settings: async function (req, res) {
    try {
      let viewFlag = true;
      let editFlag = true;
      if(!req.session.details.isSuperAdmin){
          // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
          // if (user == null || user.length == 0) {
          //   user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
          // }
          // let stringReplace = user.permission['Settings'] || [];
          let stringReplace =req.session.details.isPermission['Settings'] || [];
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
      }
      let keys = [
        "settings",
        "table",
        "dashboard",
        "status",
        "action",
        "cancel",
        "submit",
        "android_version",
        "android_store_link",
        "ios_version",
        "ios_store_link",
        "windows_version",
        "windows_store_link",
        "webgl_version",
        "webgl_store_link",
        "disable_store_link",
        "yes",
        "no",
        "screen_saver",
        "screen_saver_time",
        "minutes",
        "image_time",
        "please_upload_only_1920_1080_image",
        "select_file",
        "image_size_must_be_less_then_5mb",
        "seconds",
        "system_information",
        "error_in_systemInformation",
        "cancel",
        "update",
        "alert",
        "are_you_want_to_add_extra_data",
        "add",
        "daily_spending",
        "monthly_spending",
      ]
      let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
      let settings = await Sys.App.Services.SettingsServices.getSettingsData();
      var data = {
        App: Sys.Config.App.details, Agent: req.session.details,
        error: req.flash("error"),
        success: req.flash("success"),
        setting: settings,
        settingActive: 'active',
        viewFlag: viewFlag,
        editFlag: editFlag,
        settings: translate,
        navigation: translate
      };
      console.log('data',data);
      if(viewFlag){
        return res.render('settings/settings', data);
      }else{
        let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
        req.flash('error',translate.no_permission )//'you_have_no_permission';
        return res.redirect('/dashboard');
      }
    }
    catch (e) {
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_in_settings"], req.session.details.language)) //'Error in Settings');
      res.redirect('/');
      console.log("Error in settings :", e);
    }
  },

  settingsUpdate: async function (req, res) {
    try {
      let translation = await Sys.Helper.bingo.getTraslateData(["settings_updated_successfully", "error_updating_settings"], req.session.details.language);
      let settings = await Sys.App.Services.SettingsServices.getSettingsData({ _id: req.body.id });
      if (settings) {
        await Sys.App.Services.SettingsServices.updateSettingsData({
          _id: req.body.id
        }, {
          // defaultChips: req.body.chips,
          // notification: req.body.notification,
          // BackupDetails:{
          //   db_backup_days: req.body.db_backup_days,
          //   db_next_backup_date: moment().add(req.body.db_backup_days, 'days').format("YYYY-MM-DD"), 
          //   db_host: req.body.db_host,
          //   db_username: req.body.db_username,
          //   db_password: req.body.db_password,
          //   db_name: req.body.db_name,
          // },
          // processId: req.body.processId,
          android_version: req.body.android_version,
          ios_version: req.body.ios_version,
          android_store_link: req.body.android_store_link,
          ios_store_link: req.body.ios_store_link,
          wind_linux_version: req.body.wind_linux_version,
          disable_store_link: req.body.disable_store_link,
          windows_store_link: req.body.windows_store_link,
          webgl_version: req.body.webgl_version,
          webgl_store_link: req.body.webgl_store_link,
          daily_spending: req.body.daily_spending,
          monthly_spending: req.body.monthly_spending,
          // multitable_status: req.body.multitable_status,
          //withdrawLimit: req.body.withdrawLimit,
          // amount: req.body.amount,
          // commission: req.body.commission,
          // expireTime: req.body.expireTime
        });

        Sys.Setting = await Sys.App.Services.SettingsServices.getSettingsData({});

        // Send PlayerHallLimit broadcast to all socket players
        if(req.body.daily_spending != settings.daily_spending || req.body.monthly_spending != settings.monthly_spending ){
          Sys.Io.emit('PlayerHallLimit', { });
        }
      
        req.flash('success', translation.settings_updated_successfully) //'Settings updated successfully');
        res.redirect('/settings');
      }
      else {
        req.flash('error', translation.error_updating_settings) //'Error Updating Settings');
        res.redirect('/settings');
      }
    }
    catch (e) {
      req.flash('error', translation.error_updating_settings) //'Error Updating Settings');
      res.redirect('/settings');
      console.log("Error in settingsUpdate :", e);
    }
  },

  settingsAdd: async function (req, res) {
    try {

      await Sys.App.Services.SettingsServices.insertSettingsData({
        // rakePercenage: req.body.rakePercenage,
        // adminExtraRakePercentage: req.body.adminExtraRakePercentage,
        // defaultChips: req.body.chips,
        // notification: req.body.notification,
        // BackupDetails:{
        //   db_backup_days: req.body.db_backup_days,
        //   db_next_backup_date: moment().add(req.body.db_backup_days, 'days').format("YYYY-MM-DD"), 
        //   db_host: req.body.db_host,
        //   db_username: req.body.db_username,
        //   db_password: req.body.db_password,
        //   db_name: req.body.db_name,
        // },
        // withdrawLimit: req.body.withdrawLimit,
        // amount: req.body.amount,
        // commission: req.body.commission
        //  processId: req.body.processId,
        android_version: req.body.android_version,
        ios_version: req.body.ios_version,
        android_store_link: req.body.android_store_link,
        ios_store_link: req.body.ios_store_link,
        wind_linux_version: req.body.wind_linux_version,
        disable_store_link: req.body.disable_store_link,
        windows_store_link: req.body.windows_store_link,
        //  multitable_status: req.body.multitable_status,
        // expireTime: req.body.expireTime
      });

      Sys.Setting = await Sys.App.Services.SettingsServices.getSettingsData({});

      req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["settings_created_successfully"], req.session.details.language)) //'Settings created successfully');
      res.redirect('/settings');
    }
    catch (e) {
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_adding_setting"], req.session.details.language)) //'Error Adding Setting');
      res.redirect('/settings');
      console.log("Error in settingsAdd :", e);
    }
  },

  maintenance: async function (req, res) {
    try {

      let keys = []
      let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
      //var settings = await Sys.App.Services.SettingsServices.getSettingsData();
      //console.log("settings ->>>>>>",Sys.Setting.maintenance);
      console.log("settings ->>>>>>", Sys.Setting);
      if (Sys.Setting.maintenance == undefined) {
        await Sys.App.Services.SettingsServices.updateSettingsData(
          {
            _id: Sys.Setting._id
          }, {
          maintenance: {
            'maintenance_start_date': moment().format("YYYY-MM-DD HH:mm"),
            'maintenance_end_date': moment().format("YYYY-MM-DD HH:mm"),
            'message': 'This Application is Under Maintenance.',
            'showBeforeMinutes': '90',
            'status': 'inactive'
          }
        });
        Sys.Setting = await Sys.App.Services.SettingsServices.getSettingsData({});
      }

      let resPromise = new Promise((resolve, reject) => {
        pm2.list(0, (err, res) => {
          if (err) { reject(err) } resolve(res)
        })
      });

      resPromise.then(function (val) {

        var restartCount = (val.length == 0) ? 0 : (val[0].pm2_env.restart_time);
        var data = {
          App: Sys.Config.App.details, Agent: req.session.details,
          error: req.flash("error"),
          success: req.flash("success"),
          setting: Sys.Setting,
          maintenanceActive: 'active',
          restartCount: restartCount,
          translate: translate,
          navigation: translate
        };
        return res.render('settings/maintenance', data);
      })

    }
    catch (e) {
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_in_maintenance"], req.session.details.language)) //'Error in maintenance');
      res.redirect('/');
      console.log("Error in maintenance :", e);
    }
  },

  /*maintenanceStatusChange: async function(req, res){
    try{
      let settings = await Sys.App.Services.SettingsServices.getSettingsData();
      if (settings || settings.length >0) {
        
        if(settings.maintenance.status == 'active'){
          settings.maintenance.status = 'inactive';
          
        }else{
          settings.maintenance.status = 'active';
        }
        await Sys.App.Services.SettingsServices.updateSettingsData(
          {
            _id: req.body.id
          },{
            maintenance:settings.maintenance
          }
          )
        return res.send("success");
      }else {
        return res.send("error");
        req.flash('error',await Sys.Helper.bingo.getTraslateData(["game_name_already_exists"], req.session.details.language)) //'Problem while updating Status.');
      }

    } catch (e){
      console.log("Error",e);
    }
  },*/

  editMaintenance: async function (req, res) {
    try {

      let keys = []
      let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
      let settings = await Sys.App.Services.SettingsServices.getSettingsData();
      let maintenance_start_date = moment(settings.maintenance.maintenance_start_date).format("YYYY-MM-DD HH:mm");
      if (settings.maintenance.maintenance_start_date == null || settings.maintenance.maintenance_start_date == undefined || settings.maintenance.maintenance_start_date == '') {
        let maintenance_start_date = moment(settings.maintenance.maintenance_start_date).format("YYYY-MM-DD HH:mm");
      }
      let maintenance_end_date = moment(settings.maintenance.maintenance_end_date).format("YYYY-MM-DD HH:mm");
      if (settings.maintenance.maintenance_end_date == null || settings.maintenance.maintenance_end_date == undefined || settings.maintenance.maintenance_end_date == '') {
        let maintenance_end_date = moment(settings.maintenance.maintenance_end_date).format("YYYY-MM-DD HH:mm");
      }

      var data = {
        App: Sys.Config.App.details, Agent: req.session.details,
        error: req.flash("error"),
        success: req.flash("success"),
        setting: settings,
        settingActive: 'active',
        maintenance_start_date: maintenance_start_date,
        maintenance_end_date: maintenance_end_date,
        translate: translate,
        navigation: translate
      };
      return res.render('settings/maintenanceEdit', data);
    }
    catch (e) {
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_in_settings"], req.session.details.language)) //'Error in Settings');
      res.redirect('/maintenance');
      console.log("Error in settings :", e);
    }
  },

  updateMaintenance: async function (req, res) {
    try {
      let settings = await Sys.App.Services.SettingsServices.getSettingsData({ _id: req.params.id });
      if (settings) {
        await Sys.App.Services.SettingsServices.updateSettingsData({
          _id: req.params.id
        }, {
          maintenance: {
            maintenance_start_date: req.body.maintenance_start_date,
            maintenance_end_date: req.body.maintenance_end_date,
            message: req.body.message,
            showBeforeMinutes: req.body.showBeforeMinutes,
            status: req.body.status,
          }
        });

        Sys.Setting = await Sys.App.Services.SettingsServices.getSettingsData({});

        //START: chirag 31-08-2019 game under maintenance code 
        if (req.body.status == "active") {
          let allPlayer = await Sys.App.Services.PlayerServices.getByData({ 'socketId': { $ne: '' } });
          var playerIdArr = [];
          if (allPlayer.length > 0) {
            for (var i = 0; i < allPlayer.length; i++) {
              playerIdArr.push(allPlayer[i].id);
            }
          }

          console.log("playerIdArr: ", playerIdArr);
          let allRoom = await Sys.App.Services.RoomServices.getByData({ 'isTournamentTable': false });

          console.log("allRoom.length: ", allRoom.length);

          var playingIdArr = [];
          if (allRoom.length > 0) {
            for (var j = 0; j < allRoom.length; j++) {
              var roomData = allRoom[j];
              if (roomData.players.length > 0) {
                for (var k = 0; k < roomData.players.length; k++) {
                  var playerData = roomData.players[k];
                  var playerId = playerData.id;

                  console.log("updateMaintenance playerData.status: ", playerData.status);

                  if (playerData.status == "Playing") {
                    playingIdArr.push(playerId);
                  }

                  if (playerData.status == "Waiting") {
                    await Sys.Game.CashGame.Texas.Controllers.RoomProcess.leftRoom({ roomId: roomData.id, playerId: playerId });
                  }

                  if (playerData.status == "Ideal") {
                    await Sys.Game.CashGame.Texas.Controllers.RoomProcess.leftRoom({ roomId: roomData.id, playerId: playerId });
                  }

                  if (playerData.status == "Playing" && roomData.status == "Finished") {
                    await Sys.Game.CashGame.Texas.Controllers.RoomProcess.leftRoom({ roomId: roomData.id, playerId: playerId });
                  }
                }
              }
            }
          }

          console.log("playingIdArr: ", playingIdArr);

          var tourAllRoom = await Sys.App.Services.RoomServices.getByData({ 'isTournamentTable': true });

          console.log("tourAllRoom.length: ", tourAllRoom.length);

          var tourPlayingIdArr = [];
          var tourPlayingNameArr = [];
          if (tourAllRoom.length > 0) {
            for (var m = 0; m < tourAllRoom.length; m++) {
              var tourRoomData = tourAllRoom[m];
              if (tourRoomData.players.length > 0) {
                for (var n = 0; n < tourRoomData.players.length; n++) {
                  if (tourRoomData.players[n].status == "Playing") {
                    var tourPlayerId = tourRoomData.players[n].id;
                    tourPlayingIdArr.push(tourPlayerId);
                    tourPlayingNameArr.push(tourRoomData.players[n].playerName);
                  }
                }
              }
            }
          }

          console.log("tourPlayingIdArr: ", tourPlayingIdArr);
          console.log("tourPlayingNameArr: ", tourPlayingNameArr);

          for (var l = 0; l < playerIdArr.length; l++) {
            var playerId = playerIdArr[l];
            console.log("playingIdArr.indexOf(playerId): ", playingIdArr.indexOf(playerId));
            console.log("playerIdArr[l]: ", playerIdArr[l]);
            if (playingIdArr.indexOf(playerId) == -1 && tourPlayingIdArr.indexOf(playerId) == -1) {
              var playerDetail = await Sys.App.Services.PlayerServices.getSinglePlayerData({ '_id': playerId });
              var socketId = playerDetail.socketId;
              if (socketId != "") {
                await Sys.Io.to(socketId).emit('forceLogOut', {
                  playerId: playerId,
                  message: "System under maintenance, please login after sometimes",
                });

                //await Sys.Io.sockets.connected[socketId].disconnect();

                await Sys.Game.Common.Services.PlayerServices.update({ _id: playerId }, { socketId: '' });
              }
            }
          }

          //await Sys.Io.emit('maintenanceServer',{status:'success', 'message':'Server gose under maintenance in '+req.body.showBeforeMinutes+' minutes'});
          var message = ' Server ce se za ' + req.body.showBeforeMinutes + ' minute ugasiti i ponovno pokrenit. \n Der Server wird in ' + req.body.showBeforeMinutes + ' Minuten neu gestartet.'
          await Sys.Io.emit('maintenanceServer', { status: 'success', 'message': message });
        }
        //END: chirag 31-08-2019 game under maintenance code 
        let maintenanceMode = false;
        if (Sys.Setting && Sys.Setting.maintenance) {
          if (Sys.Setting.maintenance.status == 'active') {
            maintenanceMode = true;
          }
        }
        Sys.Config.App.details.maintenanceMode = maintenanceMode;
        req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["maintenance_settings_updated_successfully"], req.session.details.language)) //'Maintenance Settings updated successfully');
        if (req.body.DailyReports == true)
          return "success";
        else
          res.redirect('/maintenance');

      }
      else {
        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_updating_maintenance_settings"], req.session.details.language)) //'Error Updating Maintenance Settings');
        if (req.body.DailyReports == true) {
          console.log("Error Updating Maintenance Settings");
          return "error";
        }
        else
          res.redirect('/maintenance');
      }
    }
    catch (e) {
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["catch_error_updating_maintenance_settings"], req.session.details.language)) //' Catch Error Updating Maintenance Settings');
      console.log("Error Updating Maintenance Settings");
      if (req.body.DailyReports == true)
        return "error"
      else
        res.redirect('/maintenance');
      console.log("Error in settingsUpdate :", e);
    }
  },

  /**
    Backup game collection to specified database
  **/
  insertBatch: async function (targetCollection, documents, MongoClient, targetServerHostAndPort, targetDatabaseName, db_username, db_password) {
    let db, client;
    try {

      //let bulkInsert = collection.initializeUnorderedBulkOp();
      var insertedIds = [];
      var id;

      //let connectionString = 'mongodb://'+db_username+':'+db_password+'@'+targetServerHostAndPort;
      let connectionString = "mongodb://127.0.0.1:27017";
      //console.log(connectionString)
      client = await MongoClient.connect(connectionString, { useNewUrlParser: true });
      db = client.db(targetDatabaseName);
      var col = db.collection(targetCollection);
      var batch = col.initializeUnorderedBulkOp({ useLegacyOps: true });

      documents.forEach(function (doc) {
        //batch.insert(doc);
        id = doc._id;
        batch.find({ _id: id }).upsert().replaceOne(doc);
        insertedIds.push(id);
      });

      batch.execute();

      return insertedIds;

    } catch (e) {
      console.log("error in inserting batch data while backup", e)
    } finally {
      client.close();
    }
  },
  DailyReports: async function (req, res) {
    try {
      var runningRoom = await Sys.App.Services.RoomServices.getRoomData({ 'status': 'Running' });
      console.log("running Room length", runningRoom.length);
      let query = {}
      let start_date = new Date();
      start_date.setHours(00, 00, 00, 000);
      let end_date = new Date();
      end_date.setHours(23, 59, 59, 999);
      if (start_date && end_date) {
        query.createdAt = { "$gte": start_date, "$lte": end_date }
      }
      let dataCount = await Sys.App.Services.ChipsHistoryServices.getDailyReportsData(query);
      if (dataCount.length) {
        return res.send("alreadyData");
      } else if (runningRoom.length > 0) {
        return res.send("SomePlayer");
      } else {
        Sys.App.Controllers.ReportsController.allUserdailyBalanceReports()
        return res.send("success")
      }
    } catch (e) {
      console.log("Error", e);
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["problem_while_updating_status"], req.session.details.language)) //'Problem while updating Status.');
      return res.send("error");
    }
  },
  DailyReportsWithMaintanace: async function (req, res) {
    try {
      let the_interval = 7 * 60 * 1000
      let start_date = new Date();
      start_date.toLocaleString()
      start_date.setMinutes(start_date.getMinutes() + 5)
      let end_date = new Date();
      end_date.toLocaleString()
      end_date.setMinutes(start_date.getMinutes() + 5)
      let settings = await Sys.App.Services.SettingsServices.getSettingsData();
      // let req={}
      req.params.id = settings._id
      req.body.maintenance_start_date = start_date
      req.body.maintenance_end_date = end_date
      req.body.message = "This Application is Under Maintenance."
      req.body.showBeforeMinutes = 2
      req.body.status = "active"
      req.body.DailyReports = true
      let resUpdateMaintenance = await Sys.App.Controllers.SettingsController.updateMaintenance(req, res);
      if (resUpdateMaintenance != "success") {
        console.log("Problem while start Maintenance");
        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["problem_while_start_maintenance"], req.session.details.language)) //'Problem while start Maintenance');
        return res.send("error");
      }
      setTimeout(() => Sys.App.Controllers.ReportsController.allUserdailyBalanceReports(), the_interval);
      the_interval = 9 * 60 * 1000
      req.params.id = settings._id
      req.body.maintenance_start_date = start_date
      req.body.maintenance_end_date = end_date
      req.body.message = "This Application is Under Maintenance."
      req.body.showBeforeMinutes = 2
      req.body.status = "inactive"
      req.body.DailyReports = true
      setTimeout(() =>
        resUpdateMaintenance = Sys.App.Controllers.SettingsController.updateMaintenance(req, res), the_interval);
      if (resUpdateMaintenance != "success") {
        console.log("Problem while end Maintenance", resUpdateMaintenance);
        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["problem_while_end_maintenance"], req.session.details.language)) //'Problem while End Maintenance');
        return res.send("error");
      }
      return res.send("success")
    } catch (e) {
      console.log("Problem while generate Reports", e);
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["problem_while_generate_maintenance"], req.session.details.language)) //'Problem while generate Reports');
      return res.send("error");
    }
  },

  deleteBatch: async function (collection, documents, MongoClient) {
    let db, client;
    try {
      client = await MongoClient.connect("mongodb://127.0.0.1:27017", { useNewUrlParser: true });
      db = client.db("swiss-poker");
      var col = db.collection(collection);
      var bulkRemove = col.initializeUnorderedBulkOp({ useLegacyOps: true });

      documents.forEach(async function (doc) {
        //bulkRemove.find({_id: doc._id}).removeOne();
        await bulkRemove.find({ _id: doc._id }).removeOne();
      });

      bulkRemove.execute();

    } catch (e) {
      console.log("error in deleting batch data while backup", e)
    } finally {
      client.close();
    }
  },

  checkBackupStatus: async function (req, res) {
    try {
      let settings = await Sys.App.Services.SettingsServices.getSettingsData(); console.log(settings);
      var currentDate = moment(new Date()).format("YYYY-MM-DD"); console.log("current date", currentDate)
      if (settings.BackupDetails && settings.BackupDetails.db_backup_days && settings.BackupDetails.db_next_backup_date && currentDate == settings.BackupDetails.db_next_backup_date) {
        let expiryDate = moment(new Date()).subtract(3, 'months').format("YYYY-MM-DD"); // months
        console.log("Expiry Date", expiryDate);
        //let backupData = await Sys.App.Services.GameService.getByData({'createdAt': {$lt: expiryDate } });
        let targetCollection = 'game_' + currentDate;
        let sourceCollection = 'game';
        let targetServerHostAndPort = settings.BackupDetails.db_host;
        let targetDatabaseName = settings.BackupDetails.db_name;
        const MongoClient = require('mongodb').MongoClient;

        var count;
        while ((count = await Sys.App.Services.GameService.getGameCount({ 'createdAt': { $lt: expiryDate } })) > 0) {
          console.log(count + " documents remaining");
          let sourceDocs = await Sys.App.Services.GameService.getLimitedGame({ 'createdAt': { $lt: expiryDate } });
          let idsOfCopiedDocs = await module.exports.insertBatch(targetCollection, sourceDocs, MongoClient, targetServerHostAndPort, targetDatabaseName, settings.BackupDetails.db_username, settings.BackupDetails.db_password);
          console.log("bulk inserted ids", idsOfCopiedDocs);
          if (typeof idsOfCopiedDocs !== 'undefined' && idsOfCopiedDocs.length > 0) {
            let targetDocs = await Sys.App.Services.GameService.getByData({ _id: { $in: idsOfCopiedDocs } });
            await module.exports.deleteBatch(sourceCollection, targetDocs, MongoClient);
          }

        }
        console.log("iddddd", settings._id);
        await Sys.App.Services.SettingsServices.updateSettingsData({
          _id: settings._id
        }, {
          BackupDetails: {
            db_backup_days: settings.BackupDetails.db_backup_days,
            db_next_backup_date: moment(currentDate).add(settings.BackupDetails.db_backup_days, 'days').format("YYYY-MM-DD"),
            db_host: settings.BackupDetails.db_host,
            db_username: settings.BackupDetails.db_username,
            db_password: settings.BackupDetails.db_password,
            db_name: settings.BackupDetails.db_name,
          }
        });

        res.send("Backup completed");
      } else {
        console.log("NOO");
      }
    } catch (e) {
      console.log("Error in checkBackupStatus of game collection :", e);
    }
  },

  // restart server
  restartServer: async function (req, res) {
    try {

      console.log("restart the server");
      /*pm2.restart(0, function (err, proc) {
        if (err){
         throw new Error('err');
         return res.send("error");
          
        } 
      });*/
      setTimeout(function () {
        pm2.restart(Sys.Setting.processId);
      }, 1000);

      return res.send("success");
    } catch (e) {
      console.log("Error", e);
      return res.send("error");
    }
  },

  addScreenSaverData: async function (req, res) {
    try {

      let { screenSaverTime, screenSaver, imageId } = req.body
      screenSaver = screenSaver ? true : false

      if (!req.body.id) {
        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_updating_settings"], req.session.details.language)) //'Error Updating Settings');
        return res.redirect('/settings');
      }

      let settings = await Sys.App.Services.SettingsServices.getSettingsData();

      let imageDatainSetting = settings.imageTime

      let imageData = []
      if (typeof imageId === 'object') {
        for (let i = 0; i < imageId.length; i++) {
          const element = imageId[i];
          let fliterData = imageDatainSetting.find(obj => obj.id === element) || {}
          let newobj = {
            id: element,
            time: req.body['time' + element] || fliterData.time || '',
            image: fliterData.image || ''
          };

          let image = req.files && req.files["image" + element]
          if (image) {
            let fileName = Date.now() + image.name
            imageUpload(image, fileName)
            newobj.image = "/admin/images/" + fileName
          }
          imageData.push(newobj)
        }

      } else {
        let fliterData = imageDatainSetting.find(obj => obj.id === imageId) || {}
        let newobj = {
          id: imageId,
          time: req.body['time' + imageId] || fliterData.time || '',
          image: fliterData.image || ''
        };

        let image = req.files && req.files["image" + imageId]
        if (image) {
          let fileName = Date.now() + image.name
          imageUpload(image, fileName)
          newobj.image = "/admin/images/" + fileName
        }
        imageData.push(newobj)
      }

      await Sys.App.Services.SettingsServices.updateSettingsData({
        _id: req.body.id
      }, {
        screenSaver: screenSaver,
        screenSaverTime: screenSaverTime,
        imageTime: imageData
      })

      Sys.Setting = await Sys.App.Services.SettingsServices.getSettingsData({});
      Sys.Io.emit('updateScreenSaver', {
        screenSaver: screenSaver,
        screenSaverTime: screenSaverTime,
        imageTime: imageData
      });

      req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["screen_saver_data_update_successfully"], req.session.details.language)) //'Screen saver data update successfully');
      return res.redirect('/settings');

    } catch (error) {
      console.log("addScreenSaverData error", error);
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["screen_saver_data_not_add"], req.session.details.language)) //'Screen saver data not add');
      res.redirect('/');
      // req.redirect("/settings")
    }
  },


  systemInformation: async function (req, res) {
    try {
      let viewFlag = true;
      let editFlag = true;
      if(!req.session.details.isSuperAdmin){
        // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
        // if (user == null || user.length == 0) {
        //   user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
        // }
        // let stringReplace = user.permission['System Information'] || [];
        let stringReplace =req.session.details.isPermission['System Information'] || [];
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
      } 
      let keys = [
        "system_information",
        "error_in_systemInformation",
        "cancel",
        "update",
        "alert",
        "are_you_want_to_add_extra_data",
        "add",
      ]
      let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
      let settings = await Sys.App.Services.SettingsServices.getSettingsData();
      
      var data = {
        App: Sys.Config.App.details, Agent: req.session.details,
        error: req.flash("error"),
        success: req.flash("success"),
         setting: settings,
        SystemInformation: 'active',
        viewFlag: viewFlag,
        editFlag: editFlag,
        settings: translate,
        session: req.session.details,
        navigation: translate,
      };
      return res.render('SystemInformation/systemInformation', data);
    }
    catch (e) {
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_in_systemInformation"], req.session.details.language)) //'Error in Settings');
      res.redirect('/');
      console.log("Error in System Information :", e);
    }
  },
  editSystemInformation: async function (req, res) {
    try {
      console.log("********", req.body);

      let setting = await Sys.App.Services.SettingsServices.getSettingsData({});

      console.log("🚀 ~ setting:", setting);

      await Sys.App.Services.SettingsServices.updateSettingsData({
        _id: setting._id
      }, {
        systemInformationData: req.body.content
      });
      Sys.Setting = await Sys.App.Services.SettingsServices.getSettingsData({});

      return res.send({ status: "success", message: "Success" });

      // req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["settings_created_successfully"], req.session.details.language))
      // res.redirect('/settings');
    }
    catch (e) {
      req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_adding_setting"], req.session.details.language)) //'Error Adding Setting');
      res.redirect('/settings');
      console.log("Error in settingsAdd :", e);
    }
  },

}

function imageUpload(image, fileName) {
  image.mv("public/admin/images/" + fileName, async function (err) {
    if (err) {
      console.log(err);
      return response.status(500).json({ message: 'Error uploading image' });
    }
    console.log("fileName", fileName);
  })
}