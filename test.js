const _ = require('lodash')
const Redis = require('ioredis')
const debug = require('debug')('tests')

const redis = new Redis(process.env.REDIS_URL)

redis.once('connect', () => {
  const dbIndex = process.env.TEST_DB_NO || 1
  redis.select(dbIndex)
    .then(runTests)
    .catch(err => {
      console.error('*** problem with TEST_DB_NO (%d): %s **\n', dbIndex,
        err.message.substr(err.message.indexOf('ERR ')+4))
      process.exit(1)
    })
})

const {
  createEvent,
  autojoinEvent,
  getEventsFor,
  joinEvent,
  cancelEvent
} = require('.')(redis)

const user1 = { id: '1', alias: 'user1' }
const user2 = { id: '2', alias: 'user2' }
const user3 = { id: '3', alias: 'user3' }

const perUserTimeoutSec = 2

function delay(seconds) {
  debug('delaying %d seconds', seconds)

  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

function testAutojoinShouldFailNoEvents() {
  debug('Running test AutojoinShouldFailNoEvents')

  return redis.flushdb()
    .then(() => {
      return autojoinEvent({
        userId: user1.id,
        userAlias: user1.alias
      })
    })
    .then(event => {
      if (event) {
        debug('got event', event)
        throw new Error(`did not expect an event but got one: ${JSON.stringify(event)}`)
      }
    })
}

function testAutojoinFailThenCreate() {
  debug('Running test AutojoinFailThenCreate')

  return redis.flushdb()
    .then(() => {
      return autojoinEvent({
        userId: user1.id,
        userAlias: user1.alias
      })
    })
    .then(event => {
      if (event) {
        debug('got event', event)
        throw new Error(`did not expect an event but got one: ${JSON.stringify(event)}`)
      }

      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(event => {
      if (!event)
        throw new Error('failed to create event')
    })
}

function testCreateAutoexpires() {
  debug('Running test CreateAutoexpires')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(function (event) {
      if (!event)
        throw new Error('failed to create event')

      this.createdEvent = event
      debug('created event', this.createdEvent)

      return delay(event.capacity * (perUserTimeoutSec + 1))
    })
    .then(function () {
      return getEventsFor(user1.id)
    })
    .then(function (events) {
      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected event to have been expired')
      }
    })
}

function testCreateThenAutojoin() {
  debug('Running test CreateThenAutojoin')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias,
        capacity: 2
      })
    })
    .then(function (event) {
      debug('got event', event)
      if (event.id !== this.createdEvent.id) {
        throw new Error('expected to autojoin created event')
      }

      return event
    })
}

function testCreateThenGet() {
  debug('Running test CreateThenGet')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return getEventsFor(user1.id)
    })
    .then(function (events) {
      if (!_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected to find event since user created event')
      }
    })
}

function testNoSelfWhitelist() {
  debug('Running test NoSelfWhitelist')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        whitelist: [user1.id]
      })
    })
    .then(function (event) {
      throw new Error('should have failed since creator is on whitelist')
    })
    .catch(err => {})
}

function testNoSelfBlacklist() {
  debug('Running test NoSelfBlacklist')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        blacklist: [user1.id]
      })
    })
    .then(function (event) {
      throw new Error('should have failed since creator is on blacklist')
    })
    .catch(err => {})
}

function testGetWhitelisted() {
  debug('Running test GetWhitelisted')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        whitelist: [user2.id]
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return getEventsFor(user2.id)
    })
    .then(events => {
      if (!_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected to find event since user was on whitelist')
      }
    })
}

function testAutojoinShouldFailForAlreadyJoinedUser() {
  debug('Running test AutojoinShouldFailForAlreadyJoinedUser')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias
      })
    })
    .then(function (event) {
      if (event.id !== this.createdEvent.id) {
        debug('got event', event)
        throw new Error('expected to autojoin created event')
      }

      // again

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias
      })
    })
    .then(function (event) {
      if (event) {
        debug('got event', event)
        throw new Error('expected to not autojoin created event since already joined')
      }
    })
}

function testNoAutojoinBlacklisted() {
  debug('Running test NoAutojoinBlacklisted')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        blacklist: [user2.id]
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias
      })
    })
    .then(function (event) {
      if (event && event.id === this.createdEvent.id) {
        debug('got event', event)
        throw new Error('should not have got event since user was on blacklist')
      }
    })
}

function testAcceptFlow() {
  debug('Running test AcceptFlow')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        whitelist: [user2.id]
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return joinEvent(user2.id, user2.alias, event.id)
    })
    .then(function (event) {
      if (event.id !== this.createdEvent.id) {
        debug('got event', event)
        throw new Error('expected to accept event whitelisting/invite')
      }
    })
}

function testAcceptShouldFailNotWhitelisted() {
  debug('Running test AcceptShouldFailNotWhitelisted')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        whitelist: [user2.id]
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return joinEvent(user3.id, user3.alias, event.id)
    })
    .catch(err => {})
}

function testCreateExpireGetShouldBeMissing() {
  debug('Running test CreateExpireGetShouldBeMissing')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return delay(perUserTimeoutSec * 2 + 1)
    })
    .then(function () {
      return getEventsFor(user1.id)
    })
    .then(function (events) {
      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected event to have expired')
      }
    })
}

function testCancelEvent() {
  debug('Running test CancelEvent')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return cancelEvent(user1.id, event.id)
    })
    .then(function () {
      return getEventsFor(user1.id)
    })
    .then(function (events) {
      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected event to have been canceled')
      }
    })
}

function testAutojoinStartsEvent() {
  debug('Running test AutojoinStartsEvent')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias
      })
    })
    .then(function (event) {
      this.joinedEvent = event

      if (!event.startedAt) {
        debug('got event', event)
        throw new Error('expected event to have started')
      }

      return getEventsFor(user1.id)
    })
    .then(function (events) {
      if (!_.find(events.active, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.createdEvent.id} to be in active list for user1`)
      }

      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.createdEvent.id} to not be in pending list for user1`)
      }

      return getEventsFor(user2.id)
    })
    .then(function (events) {
      if (!_.find(events.active, {id: this.joinedEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.joinedEvent.id} to be in active list for user2`)
      }

      if (_.find(events.pending, {id: this.joinedEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.joinedEvent.id} to not be in pending list for user2`)
      }
    })
}

function testAcceptStartsEvent() {
  debug('Running test AcceptStartsEvent')

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        whitelist: [user2.id]
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return joinEvent(user2.id, user2.alias, event.id)
    })
    .then(function (event) {
      if (event.id !== this.createdEvent.id) {
        debug('got event', event)
        throw new Error('expected to accept event whitelisting/invite')
      }

      this.joinedEvent = event
      return getEventsFor(user1.id)
    })
    .then(function (events) {
      if (!_.find(events.active, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.createdEvent.id} to be in active list for user1`)
      }

      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.createdEvent.id} to not be in pending list for user1`)
      }

      return getEventsFor(user2.id)
    })
    .then(function (events) {
      if (!_.find(events.active, {id: this.joinedEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.joinedEvent.id} to be in active list for user2`)
      }

      if (_.find(events.pending, {id: this.joinedEvent.id})) {
        debug('got events', events)
        throw new Error(`expected event ${this.joinedEvent.id} to not be in pending list for user2`)
      }
    })
}

function testAutojoinWithNonMatchingOptionsShouldNotFindEvent() {
  debug('Running test AutojoinWithNonMatchingOptionsShouldNotFindEvent')

  const user1Options = 'opt1=foo opt2=bar opt3=42'
  const user2Options = 'opt1=foo opt2=baz opt3=42'

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        params: user1Options
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias,
        params: user2Options
      })
    })
    .then(function (event) {
      if (event) {
        debug('got event', event)
        throw new Error('expected to not find autojoinable event')
      }
    })
}

function testAutojoinWithMatchingOptionsShouldFindEvent() {
  debug('Running test AutojoinWithMatchingOptionsShouldFindEvent')

  const user1Options = 'opt1=quux opt2=doo opt3=84'
  const user2Options = user1Options

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: 2,
        perUserTimeoutSec,
        params: user1Options
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias,
        params: user2Options
      })
    })
    .then(function (event) {
      if (!event || event.id !== this.createdEvent.id) {
        debug('got event', event)
        throw new Error('expected to find created event for autojoining')
      }
    })
}

function testCreateLargeEventAndCancelShouldDelist() {
  debug('Running test CreateLargeEventAndCancelShouldDelist')

  // create event that starts when 8 players join
  // have 2 others join then cancel it

  const largeEventUserCount = 8
  const largeEventOptions = 'opt1=foo'

  return redis.flushdb()
    .then(() => {
      return createEvent({
        userId: user1.id,
        userAlias: user1.alias,
        capacity: largeEventUserCount,
        perUserTimeoutSec,
        params: largeEventOptions
      })
    })
    .then(function (event) {
      this.createdEvent = event
      debug('created event', this.createdEvent)

      return autojoinEvent({
        userId: user2.id,
        userAlias: user2.alias,
        capacity: largeEventUserCount,
        params: largeEventOptions
      })
    })
    .then(function (event) {
      if (!event || event.id !== this.createdEvent.id) {
        debug('got event', event)
        throw new Error('expected to find created event for autojoining')
      }

      return autojoinEvent({
        userId: user3.id,
        userAlias: user3.alias,
        capacity: largeEventUserCount,
        params: largeEventOptions
      })
    })
    .then(function (event) {
      if (!event || event.id !== this.createdEvent.id) {
        debug('got event', event)
        throw new Error('expected to find created event for autojoining')
      }

      return cancelEvent(user1.id, this.createdEvent.id)
    })
    .then(function () {
      return getEventsFor(user1.id)
    })
    .then(function (events) {
      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected event to have been canceled')
      }

      return getEventsFor(user2.id)
    })
    .then(function (events) {
      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected event to have been canceled')
      }

      return getEventsFor(user3.id)
    })
    .then(function (events) {
      if (_.find(events.pending, {id: this.createdEvent.id})) {
        debug('got events', events)
        throw new Error('expected event to have been canceled')
      }
    })
}

function runTests() {
  return testAutojoinShouldFailNoEvents()
    .then(testAutojoinFailThenCreate)
    .then(testCreateAutoexpires)
    .then(testCreateThenAutojoin)
    .then(testCreateThenGet)
    .then(testNoSelfWhitelist)
    .then(testNoSelfBlacklist)
    .then(testGetWhitelisted)
    .then(testAutojoinShouldFailForAlreadyJoinedUser)
    .then(testNoAutojoinBlacklisted)
    .then(testAcceptFlow)
    .then(testAcceptShouldFailNotWhitelisted)
    .then(testCreateExpireGetShouldBeMissing)
    .then(testCancelEvent)
    .then(testAutojoinStartsEvent)
    .then(testAcceptStartsEvent)
    .then(testAutojoinWithNonMatchingOptionsShouldNotFindEvent)
    .then(testAutojoinWithMatchingOptionsShouldFindEvent)
    .then(testCreateLargeEventAndCancelShouldDelist)
    .then(() => {
      console.log('all tests have passed ☑️')
      debug('ok')
      process.exit()
    })
    .catch(err => {
      console.trace(err)
      process.exit()
    })
}
