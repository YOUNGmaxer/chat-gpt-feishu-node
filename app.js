require('dotenv').config()
const Koa = require('koa')
const app = new Koa()
const eventHander = require('./index')

app.use(async (ctx, next) => {
    ctx.body = await eventHander(ctx.body, ctx)
})

app.listen(9000, () => {
    console.log('server is listening on 9000')
})