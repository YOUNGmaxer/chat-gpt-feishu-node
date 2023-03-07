require('dotenv').config()
const Koa = require('koa')
const bodyParser = require('koa-bodyparser')
const app = new Koa()
const eventHander = require('./index')

app.use(bodyParser())

app.use(async ctx => {
    ctx.body = await eventHander(ctx.request.body || {}, ctx)
})

app.listen(9000, () => {
    console.log('server is listening on 9000')
})