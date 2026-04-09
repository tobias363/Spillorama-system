'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const settingsModel  = mongoose.model('setting');

const DEFAULT_MAINTENANCE = Object.freeze({
  maintenance_start_date: '',
  maintenance_end_date: '',
  message: 'This Application is Under Maintenance.',
  showBeforeMinutes: '90',
  status: 'inactive'
});

const DEFAULT_SETTINGS = Object.freeze({
  supportMessage: '',
  android_version: 0,
  ios_version: 0,
  wind_linux_version: 0,
  webgl_version: 0,
  disable_store_link: 'Yes',
  android_store_link: '',
  ios_store_link: '',
  windows_store_link: '',
  webgl_store_link: '',
  screenSaver: false,
  screenSaverTime: '5',
  imageTime: [],
  daily_spending: 0,
  monthly_spending: 0,
  processId: 0,
  maintenance: DEFAULT_MAINTENANCE,
  gameTicketCounts: {}
});

function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function toPlainSettingDoc(settings) {
  if (!settings) return null;
  return typeof settings.toObject === 'function' ? settings.toObject() : { ...settings };
}

function normalizeSettingsDoc(settings) {
  const current = toPlainSettingDoc(settings);
  if (!current) return null;

  const defaults = cloneDefaultSettings();
  return {
    ...defaults,
    ...current,
    imageTime: Array.isArray(current.imageTime) ? current.imageTime : defaults.imageTime,
    maintenance: {
      ...defaults.maintenance,
      ...(current.maintenance && typeof current.maintenance === 'object' ? current.maintenance : {})
    },
    gameTicketCounts: current.gameTicketCounts && typeof current.gameTicketCounts === 'object'
      ? current.gameTicketCounts
      : defaults.gameTicketCounts
  };
}

function buildMissingSettingsPatch(settings) {
  const current = toPlainSettingDoc(settings) || {};
  const defaults = cloneDefaultSettings();
  const patch = {};

  for (const [key, value] of Object.entries(defaults)) {
    if (key === 'maintenance') {
      const currentMaintenance = current.maintenance && typeof current.maintenance === 'object'
        ? current.maintenance
        : null;

      if (!currentMaintenance) {
        patch.maintenance = value;
        continue;
      }

      const missingMaintenance = {};
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (currentMaintenance[nestedKey] === undefined) {
          missingMaintenance[nestedKey] = nestedValue;
        }
      }

      if (Object.keys(missingMaintenance).length > 0) {
        patch.maintenance = {
          ...value,
          ...currentMaintenance,
          ...missingMaintenance
        };
      }
      continue;
    }

    if (key === 'imageTime') {
      if (!Array.isArray(current.imageTime)) {
        patch.imageTime = value;
      }
      continue;
    }

    if (key === 'gameTicketCounts') {
      if (!current.gameTicketCounts || typeof current.gameTicketCounts !== 'object') {
        patch.gameTicketCounts = value;
      }
      continue;
    }

    if (current[key] === undefined) {
      patch[key] = value;
    }
  }

  return patch;
}

module.exports = {


	getSettingsData: async function(data){
    try {
      return await settingsModel.findOne(data || {}).sort({ _id: 1 });
    } catch (e) {
      console.log("Error", e);
      return new Error(e);
    }
	 },

  getOrCreateSettingsData: async function() {
    try {
      let settings = await settingsModel.findOne({}).sort({ _id: 1 });

      if (!settings) {
        settings = await settingsModel.create(cloneDefaultSettings());
        console.log('[RuntimeSettings] Created default settings document:', settings._id.toString());
      }

      const patch = buildMissingSettingsPatch(settings);
      if (Object.keys(patch).length > 0) {
        settings = await settingsModel.findOneAndUpdate(
          { _id: settings._id },
          { $set: patch },
          { new: true }
        );
        console.log('[RuntimeSettings] Backfilled missing settings fields:', Object.keys(patch).join(', '));
      }

      return normalizeSettingsDoc(settings);
    } catch (e) {
      console.log("Error in getOrCreateSettingsData", e);
      return new Error(e);
    }
  },

  getByData: async function(data){
        try {
          return  await settingsModel.find(data);
        } catch (e) {
          console.log("Error",e);
        }
  },

  updateSettingsData: async function(condition, data){
        try {
         return await settingsModel.updateOne(condition, data);
        } catch (e) {
          console.log("Error",e);
        }
  },

  insertSettingsData: async function(data){
        try {
          return await settingsModel.findOneAndUpdate(
            {},
            {
              $set: data,
              $setOnInsert: cloneDefaultSettings()
            },
            {
              new: true,
              upsert: true,
              sort: { _id: 1 },
              setDefaultsOnInsert: true
            }
          );
        } catch (e) {
          console.log("Error",e);
        }
  },

  findOneAndUpdateSettingsData: async function(condition, query, filter){
    try {
     return await settingsModel.findOneAndUpdate(condition, query, filter).lean();
    } catch (e) {
      console.log("Error",e);
    }
  },


}
