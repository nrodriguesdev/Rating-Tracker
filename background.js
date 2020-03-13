'use strict';

/**
 *refreshTimer handles the timer that appears on the extension icon when there are
 *no tasks available to the user and they are waiting for the next page refresh.
 */
const refreshTimer = {
  time: 0,
  startTime: null,
  interval: null,

  start(time) {
    this.time = time;
    let date = new Date();
    this.startTime = date.getTime();
    this.interval = window.setInterval(refreshTimer.update, 1000);
  },

  restart() {
    if (this.time <= 0) return;

    let date = new Date();
    let currentTime = date.getTime();
    let timePassed = currentTime - this.startTime;
    this.time -= Math.floor(timePassed / 1000);
    if (this.time > 0) {
      this.update();
      this.interval = window.setInterval(refreshTimer.update, 1000);
    }
  },

  update() {
    console.log("Updating refresh timer");
    if (refreshTimer.time < 0) {
      refreshTimer.clear();
    } else {
      chrome.browserAction.setBadgeText({text: refreshTimer.time-- + ''});
    }
  },

  clear() {
    window.clearInterval(refreshTimer.interval);
    chrome.browserAction.setBadgeText({text: ''});
  }
};

/**
 * Returns a string that can be used to lookup work data from a particular day.
 * @param {Object} dateObj that represents that day you want to look up
 * @returns {string} containing date
 */
function getSpecificDateKey(dateObj) {
  return dateObj.getMonth() + '/' + dateObj.getDate() + '/' + dateObj.getFullYear();
}

/**
 * Returns a string that can be used to lookup work data from the current day.
 * @returns {string} containing date
 */
function getDateKey() {
  let date = new Date();

  return getSpecificDateKey(date);
}

function submitHours() {
  const dateString = getDateKey();
  chrome.storage.sync.get(dateString, (data) => {
    chrome.storage.local.get(['taskTimestamp', 'taskTime'], (taskInfo) => {
      let taskTimeLimit = taskInfo['taskTime'];
      let currentTime = new Date().getTime(); // time in milliseconds
      let taskTimeElapsed = currentTime - taskInfo['taskTimestamp'];

      let minutesElapsed = taskTimeElapsed / 60000;
      let minutesWorked = ((minutesElapsed < taskTimeLimit) ?  minutesElapsed : taskTimeLimit);

      console.log("Logging now..");
      let minutesRecorded = getValue(data, dateString, 0.0);
      let totalMinutes = minutesRecorded + minutesWorked;

      chrome.storage.sync.set({[dateString] : totalMinutes}, function() {
        console.log("Logging " + minutesWorked + " minutes for a total of " + totalMinutes + " minutes.")
      });
      chrome.storage.local.set({'taskActive': false});
    })
  });
}

/**
 * Sums hours worked across the week
 */
function calculateWeekHours() {
  let date = new Date();
  date.setDate(date.getDate() - date.getDay());

  let dateKeys = [];
  for (let i = 0; i < 7; i++) {
    dateKeys[i] = getSpecificDateKey(date);
    date.setDate(date.getDate() + 1);
  }

  return new Promise((resolve, reject) => {
    let totalMinutes = 0.0;
    chrome.storage.sync.get(dateKeys, (items) => {
      let values = Object.values(items);
      for (let i = 0; i < values.length; i++) {
        if (values[i] !== 'undefined') {
          totalMinutes += values[i];
        }
      }

      if (totalMinutes === 'undefined') {
        reject(null);
      } else {
        resolve(totalMinutes)
      }
    });
  })
}

/**
 * Handles message-passing from content-scripts. Delivers cached settings/data to
 * content scripts when requested.
 */
chrome.runtime.onMessage.addListener( 
  function(request, sender, sendResponse) {
    switch(request.status) {
      case 'cancel-task':
        chrome.storage.local.get('taskActive', (status) => {
          if (status['taskActive']) {
            chrome.storage.local.set({'taskID': -1, 'taskTimestamp': null, 'taskTime': 0, 'taskActive': false});
          }
        });
        break;

      case 'submit-task':
        console.log("Task submitted");
        chrome.storage.local.get('taskActive', (status) => {
          if (status['taskActive']) {
            submitHours();
          }
        });
        break;

      // start icon badge timer when refresh time is received from content script
      case 'refresh-timer':
        refreshTimer.clear();
        refreshTimer.start(request.time);
        break;
    }
  }
);

/**
 * Returns the value found in the object literal and handles undefined results.
 * @param {Object} data Object literal that contains data retrieved from Chrome storage.
 * @param {string} key String representing the key of the value being handled.
 * @param {*} defaultValue If the value pulled from the object literal is undefined, this becomes its new value.
 */
function getValue(data, key, defaultValue) {
  let result = data[key];
  if (typeof result === 'undefined') {
      result = defaultValue;
  }

  return result;
}

/**
 * Returns a string with an appropriate goal notification, if there is one to make. 
 * Returns empty string if no notification will be made.
 * @param {string} periodID String representing period of time to consider. ('daily' or 'weekly')
 * @param {Object} storage Object literal containing values for beforeGoalNotificationsSetting, goalNotificationsSetting,
*                  and notificationMinutes from sync storage.
 * @param {number} minutesWorked Float containing the latest minutes worked for this period.
 */
function getNotificationString(periodID, storage, minutesWorked) {
  let notificationText = '';
  let goalHours = storage[periodID + 'HourGoal'];
  let goalMinutes = goalHours * 60;

  if (minutesWorked < goalMinutes) {
    let timeDifference = goalMinutes - minutesWorked;
    let beforeGoalNotificationEnabled = storage['beforeGoalNotificationsSetting'];
    let notificationMinutes = storage['notificationMinutes'];

    if (beforeGoalNotificationEnabled && (timeDifference <= notificationMinutes)) {
      notificationText += 'You are ' + timeDifference.toFixed(2) + ' minutes away from achieving your ' + periodID + ' goal! ';
    }
  } else {
    let goalNotificationEnabled = storage['goalNotificationsSetting'];

    if (goalNotificationEnabled) {
      notificationText += 'You have achieved your ' + periodID + ' goal of ' + goalHours + ' hours! ';
    }
  }

  return notificationText;
}

/**
 * Creates a Chrome notification if a goal has been met or is close to being met.
 * @param {number} dailyMinutes Float containing the minutes worked for the day.
 * @param {number} weeklyMinutes Float containing the minutes worked for the week.
 */
function handleNotifications(dailyMinutes, weeklyMinutes) {
  chrome.storage.sync.get(['dailyHourGoal', 'weeklyHourGoal', 'beforeGoalNotificationsSetting', 'notificationMinutes',
    'goalNotificationsSetting'], (storage) => {
    let dailyNotification = getNotificationString('daily', storage, dailyMinutes);
    let weeklyNotification = getNotificationString('weekly', storage, weeklyMinutes);
    let notificationText = dailyNotification + weeklyNotification;

    if (notificationText != '') {
      chrome.notifications.create({type: 'basic', iconUrl: 'images/icon128.png', title: 'Gooooooooal!!', message: notificationText});
    }
  });
}

/**
 * Listens for changes in storage, which occur when new settings are saved or when
 * a task is completed. Updates the cached storage values and handles task notifications.
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  for (const [key, value] of Object.entries(changes)) {
    let todaysDateKey = getDateKey();
    if (key === todaysDateKey) {
      let oldMinutes = getValue(value, 'oldValue', 0);
      let newMinutes = getValue(value, 'newValue', 0);

      if (newMinutes > oldMinutes) {
        calculateWeekHours()
            .then(function(weeklyMinutes) {
              chrome.runtime.sendMessage({status: "update-calendar", timeDay: newMinutes, timeWeek: weeklyMinutes});
              handleNotifications(newMinutes, weeklyMinutes);
            })
            .catch(function(val) {
              console.log('ERROR: Couldnt calculate weekly work hours.')
            });
      }
    }

    if (key === 'refreshTimerSetting') {
      let refreshTimerEnabled = value.newValue;
      if (refreshTimerEnabled) { 
        refreshTimer.restart();
      } else {
        refreshTimer.clear();
      }
    }
  }
});

//chrome.storage.sync.set({[getDateKey()] : 8});
chrome.runtime.onInstalled.addListener((details) => {
  if (details.OnInstalledReason === 'install') {
    chrome.storage.sync.set({'minTime': 30});
    chrome.storage.sync.set({'maxTime': 60});
    chrome.storage.sync.set({'refreshSetting': true});
    chrome.storage.sync.set({'refreshSoundSetting': true});
    chrome.storage.sync.set({'refreshSoundVolumeSetting': 100});
    chrome.storage.sync.set({'refreshTimerSetting': true});
    chrome.storage.sync.set({'timeoutSoundSetting': true});
    chrome.storage.sync.set({'timeoutSoundVolumeSetting': 100});
    chrome.storage.sync.set({'dailyHourDisplaySetting': true});
    chrome.storage.sync.set({'weeklyHourDisplaySetting': true});
    chrome.storage.sync.set({'taskWebsiteSetting': false});
    chrome.storage.sync.set({'taskWebsiteURLSetting': ''});
    chrome.storage.sync.set({'employeeWebsiteSetting': false});
    chrome.storage.sync.set({'employeeWebsiteURLSetting': ''});
    chrome.storage.sync.set({'timesheetWebsiteSetting': false});
    chrome.storage.sync.set({'timesheetWebsiteURLSetting': ''});
    chrome.storage.sync.set({'dynamicGoalsSetting': false});
    chrome.storage.sync.set({'dailyHourGoal': 8.0});
    chrome.storage.sync.set({'weeklyHourGoal': 20.0});
    chrome.storage.sync.set({'goalNotificationsSetting': true});
    chrome.storage.sync.set({'beforeGoalNotificationsSetting': true});
    chrome.storage.sync.set({'notificationMinutes': 15});
  }
});