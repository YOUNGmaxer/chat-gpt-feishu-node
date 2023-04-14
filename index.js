// @version 0.0.9 调整了 axios 的报错的输出，以便于调试。
const lark = require("@larksuiteoapi/node-sdk");
var axios = require("axios");
const EventDB = new Map();
const MsgTable = new Map(); // 用于保存历史会话的表

// 如果你不想配置环境变量，或环境变量不生效，则可以把结果填写在每一行最后的 "" 内部
const FEISHU_APP_ID = process.env.APPID || ""; // 飞书的应用 ID
const FEISHU_APP_SECRET = process.env.SECRET || ""; // 飞书的应用的 Secret
const FEISHU_BOTNAME = process.env.BOTNAME || ""; // 飞书机器人的名字
const OPENAI_KEY = process.env.KEY || ""; // OpenAI 的 Key
const OPENAI_MODEL = process.env.MODEL || "gpt-3.5-turbo"; // 使用的模型
const OPENAI_MAX_TOKEN = process.env.MAX_TOKEN || 1024; // 最大 token 的值

const client = new lark.Client({
  appId: FEISHU_APP_ID,
  appSecret: FEISHU_APP_SECRET,
  disableTokenCache: false,
});

// 日志辅助函数，请贡献者使用此函数打印关键日志
function logger(param) {
  console.debug(`[CF]`, param);
}

// 回复消息
async function reply(messageId, content) {
  try{
    return await client.im.message.reply({
    path: {
      message_id: messageId,
    },
    data: {
      content: JSON.stringify({
        text: content,
      }),
      msg_type: "text",
    },
  });
  } catch(e){
    logger("send message to feishu error",e,messageId,content);
  }
}


// 根据sessionId构造用户会话
async function buildConversation(sessionId, question) {
  let prompt = [];
  
  // 从 MsgTable 表中取出历史记录构造 question
  const historyMsgs = MsgTable.get(sessionId) || [];
  for (const conversation of historyMsgs) {
      prompt.push({"role": "user", "content": conversation.question})
      prompt.push({"role": "assistant", "content": conversation.answer})
  }

  // 拼接最新 question
  prompt.push({"role": "user", "content": question})
  return prompt;
}

// 保存用户会话
function saveConversation(sessionId, question, answer) {
  const msgSize =  question.length + answer.length
  const historyMsgs = MsgTable.get(sessionId) || []
  MsgTable.set(sessionId, [...historyMsgs, {
    question,
    answer,
    msgSize,
  }]);
  // 有历史会话是否需要抛弃
  discardConversation(sessionId);
}

// 如果历史会话记录大于OPENAI_MAX_TOKEN，则从第一条开始抛弃超过限制的对话
function discardConversation(sessionId) {
  let totalSize = 0;
  const historyMsgs = MsgTable.get(sessionId) || []
  // logger(`historyMsgs: ${JSON.stringify(historyMsgs)}`)
  const historyMsgLen = historyMsgs.length;
  for (let i = historyMsgLen - 1; i >= 0; i--) {
    totalSize += historyMsgs[i].msgSize;
    if (totalSize > OPENAI_MAX_TOKEN) {
        const historyMsgs = MsgTable.get(sessionId)
        MsgTable.set(sessionId, historyMsgs.slice(i + 1, historyMsgLen))
        break;
    }
  }
}

// 清除历史会话
function clearConversation(sessionId) {
  return MsgTable.delete(sessionId)
}

// 指令处理
async function cmdProcess(cmdParams) {
  switch (cmdParams && cmdParams.action) {
    case "/help":
      await cmdHelp(cmdParams.messageId);
      break;
    case "/clear": 
      await cmdClear(cmdParams.sessionId, cmdParams.messageId);
      break;
    default:
      await cmdHelp(cmdParams.messageId);
      break;
  }
  return { code: 0 }
} 

// 帮助指令
async function cmdHelp(messageId) {
  helpText = `ChatGPT 指令使用指南

Usage:
    /clear    清除上下文
    /help     获取更多帮助
  `
  await reply(messageId, helpText);
}

// 清除记忆指令
async function cmdClear(sessionId, messageId) {
  clearConversation(sessionId)
  await reply(messageId, "✅记忆已清除");
}

// 通过 OpenAI API 获取回复
async function getOpenAIReply(prompt) {

  var data = JSON.stringify({
    model: OPENAI_MODEL,
    messages: prompt
  });

  var config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://api.openai.com/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    data: data,
    timeout: 50000
  };

  try{
      const response = await axios(config);
    
      if (response.status === 429) {
        return '问题太多了，我有点眩晕，请稍后再试';
      }
      // 去除多余的换行
      return response.data.choices[0].message.content.replace("\n\n", "");
    
  }catch(e){
    if (e.response) {
      logger(e.response.data)
      return `接口异常(1)：${e.response.data.error.message}`;
    } else {
      logger(e)
      return `接口异常(2): ${e.message}`;
    }
  }

}

// 自检函数
async function doctor() {
  if (FEISHU_APP_ID === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置飞书应用的 AppID，请检查 & 部署后重试",
        en_US:
          "Here is no FeiSHu APP id, please check & re-Deploy & call again",
      },
    };
  }
  if (!FEISHU_APP_ID.startsWith("cli_")) {
    return {
      code: 1,
      message: {
        zh_CN:
          "你配置的飞书应用的 AppID 是错误的，请检查后重试。飞书应用的 APPID 以 cli_ 开头。",
        en_US:
          "Your FeiShu App ID is Wrong, Please Check and call again. FeiShu APPID must Start with cli",
      },
    };
  }
  if (FEISHU_APP_SECRET === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置飞书应用的 Secret，请检查 & 部署后重试",
        en_US:
          "Here is no FeiSHu APP Secret, please check & re-Deploy & call again",
      },
    };
  }

  if (FEISHU_BOTNAME === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置飞书应用的名称，请检查 & 部署后重试",
        en_US:
          "Here is no FeiSHu APP Name, please check & re-Deploy & call again",
      },
    };
  }

  if (OPENAI_KEY === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置 OpenAI 的 Key，请检查 & 部署后重试",
        en_US: "Here is no OpenAI Key, please check & re-Deploy & call again",
      },
    };
  }

  if (!OPENAI_KEY.startsWith("sk-")) {
    return {
      code: 1,
      message: {
        zh_CN:
          "你配置的 OpenAI Key 是错误的，请检查后重试。OpenAI 的 KEY 以 sk- 开头。",
        en_US:
          "Your OpenAI Key is Wrong, Please Check and call again. FeiShu APPID must Start with cli",
      },
    };
  }
  return {
    code: 0,
    message: {
      zh_CN:
      "✅ 配置成功，接下来你可以在飞书应用当中使用机器人来完成你的工作。",
      en_US:
      "✅ Configuration is correct, you can use this bot in your FeiShu App",
      
    },
    meta: {
      FEISHU_APP_ID,
      OPENAI_MODEL,
      OPENAI_MAX_TOKEN,
      FEISHU_BOTNAME,
    },
  };
}

async function handleReply(userInput, sessionId, messageId, eventId) {
  const question = userInput.text.replace("@_user_1", "");
  logger("question: " + question);
  const action = question.trim();
  if (action.startsWith("/")) {
    return await cmdProcess({action, sessionId, messageId});
  }
  const prompt = await buildConversation(sessionId, question);
  const openaiResponse = await getOpenAIReply(prompt);
  saveConversation(sessionId, question, openaiResponse)
  await reply(messageId, openaiResponse);

  // update content to the event record
  const evt_record = EventDB.get(eventId);
  evt_record.content = userInput.text;
  EventDB.set(eventId, evt_record);
  return { code: 0 };
}

module.exports = async function (params, context) {
  // 如果存在 encrypt 则说明配置了 encrypt key
  if (params.encrypt) {
    logger("user enable encrypt key");
    return {
      code: 1,
      message: {
        zh_CN: "你配置了 Encrypt Key，请关闭该功能。",
        en_US: "You have open Encrypt Key Feature, please close it.",
      },
    };
  }
  // 处理飞书开放平台的服务端校验
  if (params.type === "url_verification") {
    logger("deal url_verification");
    return {
      challenge: params.challenge,
    };
  }
  // 自检查逻辑
  if (!params.hasOwnProperty("header") || context.trigger === "DEBUG") {
    return await doctor();
  }
  // 处理飞书开放平台的事件回调
  if ((params.header.event_type === "im.message.receive_v1")) {
    let eventId = params.header.event_id;
    let messageId = params.event.message.message_id;
    let chatId = params.event.message.chat_id;
    let senderId = params.event.sender.sender_id.user_id;
    let sessionId = chatId + senderId;

    // 对于同一个事件，只处理一次
    const eventObj = EventDB.get(eventId) || { count: 0 };
    const count = eventObj.count;
    // skip repeat event
    if (count != 0) {
      return { code: 1 };
    }
    EventDB.set(eventId, { event_id: eventId, count: 1 });

    // 私聊直接回复
    if (params.event.message.chat_type === "p2p") {
      // 不是文本消息，不处理
      if (params.event.message.message_type != "text") {
        await reply(messageId, "暂不支持其他类型的提问");
        logger("skip and reply not support");
        return { code: 0 };
      }
      // 是文本消息，直接回复
      const userInput = JSON.parse(params.event.message.content);
      logger(`sender: ${senderId}`)
      return await handleReply(userInput, sessionId, messageId, eventId);
    }

    // 群聊，需要 @ 机器人
    if (params.event.message.chat_type === "group") {
      // 这是日常群沟通，不用管
      if (
        !params.event.message.mentions ||
        params.event.message.mentions.length === 0
      ) {
        logger("not process message without mention");
        return { code: 0 };
      }
      // 没有 mention 机器人，则退出。
      if (params.event.message.mentions[0].name != FEISHU_BOTNAME) {
        logger("bot name not equal first mention name ");
        return { code: 0 };
      }
      const userInput = JSON.parse(params.event.message.content);
      return await handleReply(userInput, sessionId, messageId, eventId);
    }
  }

  logger("return without other log");
  return {
    code: 2,
  };
};