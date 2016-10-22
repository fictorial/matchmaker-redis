const _ = require('lodash')
const shortid = require('shortid')
const installLuaScripts = require('./lib/lua-scipts')

const pendingKey = 'events/pending'
const activeKey  = 'events/active'

var redis

function createEvent(args) {
  const userId = args.userId
  const userAlias = args.userAlias
  if (_.isUndefined(userId) || _.isUndefined(userAlias))
    return Promise.reject(new Error('user required'))

  const userCount = Math.max(2, parseInt(args.userCount, 10) || 0)

  const whitelist = _.uniq(args.whitelist || [])
  const blacklist = _.uniq(args.blacklist || [])
  if (_.indexOf(whitelist, userId) !== -1 ||
      _.indexOf(blacklist, userId) !== -1 ||
      !_.isEmpty(_.intersection(whitelist, blacklist)))
    return Promise.reject(new Error('invalid whitelist/blacklist'))

  const perUserTimeoutSec = Math.max(1, parseInt(args.perUserTimeoutSec, 10) || 30)

  const options = args.options || ''
  if (!_.isString(options))
    return Promise.reject(new Error('invalid options'))

  const event = {
    id: shortid(),
    userCount,
    options: _.trim(options),
    whitelist,
    blacklist,
    userIds: [userId],
    aliases: [userAlias]
  }

  return redis.createEvent(`events/${event.id}`, pendingKey, JSON.stringify(event)).then(() => {
    const timeout = event.userCount * perUserTimeoutSec * 1000
    setTimeout(function autoCancelEvent() {
      cancelEvent(userId, event.id).catch(err => {
        // Just eat this error since it's an automatic cancellation or expiration;
        // not a user action.
        //
        // console.warn('cannot auto-cancel event %s: %s', event.id, err.message)
      })
    }, timeout)
    return event
  })
}

function autojoinEvent(args) {
  const userId = args.userId
  const userAlias = args.userAlias
  if (_.isUndefined(userId) || _.isUndefined(userAlias))
    return Promise.reject(new Error('user required'))

  const userCount = Math.max(2, parseInt(args.userCount, 10) || 0)

  const options = args.options || ''
  if (!_.isString(options))
    return Promise.reject(new Error('invalid options'))

  return redis.autojoinEvent(
    pendingKey,
    activeKey,
    userId,
    userAlias,
    userCount,
    options,
    _.now() / 1000 | 0)
  .then(json => !json ? null : JSON.parse(json))
}

function cancelEvent(userId, eventId) {
  return redis.cancelEvent(`events/${eventId}`, pendingKey, userId)
}

function getEventsFor(userId) {
  return redis.getPendingEventsFor(pendingKey, userId).then(function (json) {
    this.pendingEvents = JSON.parse(json)
    return redis.getActiveEventsFor(activeKey, userId)
  }).then(function (json) {
    return {
      pending: this.pendingEvents,
      active: JSON.parse(json)
    }
  })
}

function joinEvent(userId, userAlias, eventId) {
  return redis.joinEvent(`events/${eventId}`, pendingKey, activeKey,
    userId, userAlias, _.now() / 1000 | 0).then(JSON.parse)
}

module.exports = function (redisClient) {
  redis = redisClient
  installLuaScripts(redisClient)
  return {createEvent, autojoinEvent, getEventsFor, joinEvent, cancelEvent}
}
