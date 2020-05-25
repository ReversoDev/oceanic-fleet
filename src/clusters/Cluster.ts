import * as Eris from 'eris';
import {worker} from 'cluster';
import {BaseClusterWorker} from './BaseClusterWorker';
import {inspect} from 'util';

export class Cluster {
    firstShardID!: number;
    lastShardID!: number;
    path!: string;
    clusterID!: number;
    clusterCount!: number;
    shardCount!: number;
    shards!: number;
    clientOptions!: any;
    bot!: Eris.Client;
    private token!: string;
    app!: BaseClusterWorker;

    constructor() {
        //@ts-ignore
        console.log = (str: any) => process.send({op: "log", msg: str});
        //@ts-ignore
        console.debug = (str: any) => process.send({op: "debug", msg: str});
        //@ts-ignore
        console.error = (str: any) => process.send({op: "error", msg: str});

        //Spawns
        process.on('uncaughtException', (err: Error) => {
            //@ts-ignore
            process.send({op: "error", msg: inspect(err)});
        });

        process.on('unhandledRejection', (reason, promise) => {
            //@ts-ignore
            process.send({op: "error", msg: 'Unhandled Rejection at: ' + inspect(promise) + ' reason: ' + reason});
        });


        
        process.on("message", message => {
            if (message.op) {
                switch (message.op) {
                    case "connect": {
                        this.firstShardID = message.firstShardID;
                        this.lastShardID = message.lastShardID;
                        this.path = message.path;
                        this.clusterID = message.clusterID;
                        this.clusterCount = message.clusterCount;
                        this.shardCount = message.shardCount;
                        this.shards = (this.lastShardID - this.firstShardID) + 1;
                        this.clientOptions = message.clientOptions;
                        this.token = message.token;

                        if (this.shards < 0) return;
                        this.connect();

                        break;
                    }
                    case "fetchUser": {
                        if (!this.bot) return;
                        const user = this.bot.users.get(message.id);
                        if (user) {
                            //@ts-ignore
                            process.send({op: "return", value: user, UUID: message.UUID});
                        }
                        
                        break;
                    }
                    case "fetchChannel": {
                        if (!this.bot) return;
                        const channel = this.bot.getChannel(message.id);
                        if (channel) {
                            //@ts-ignore
                            process.send({op: "return", value: channel, UUID: message.UUID});
                        }

                        break;
                    }
                    case "fetchGuild": {
                        if (!this.bot) return;
                        const guild = this.bot.guilds.get(message.id);
                        if (guild) {
                            //@ts-ignore
                            process.send({op: "return", value: guild, UUID: message.UUID});
                        }

                        break;
                    }
                    case "fetchMember": {
                        if (!this.bot) return;
                        const [guildID, memberID] = message.id;
                        const guild = this.bot.guilds.get(guildID);
                        if (guild) {
                            let member = guild.members.get(memberID);
                            if (member) {
                                //@ts-ignore
                                member = member.toJSON();
                                //@ts-ignore
                                process.send({op: "fetchReturn", value: member, UUID: message.UUID});
                            }
                        }

                        break;
                    }
                    case "return": {
                        this.app.ipc.emit(message.id, message.value);
                        break;
                    }
                    case "collectStats": {
                        if (!this.bot) return;
                        let shardStats: { id: number; ready: boolean; latency: number; status: string; }[] = [];
                        this.bot.shards.forEach(shard => {
                            shardStats.push({
                                id: shard.id,
                                ready: shard.ready,
                                latency: shard.latency,
                                status: shard.status
                            });
                        });
                        //@ts-ignore
                        process.send({op: "collectStats", stats: {
                            guilds: this.bot.guilds.size,
                            users: this.bot.users.size,
                            uptime: this.bot.uptime,
                            voice: this.bot.voiceConnections.size,
                            largeGuilds: this.bot.guilds.filter(g => g.large).length,
                            shardStats: shardStats,
                            ram: process.memoryUsage().rss
                        }});

                        break;
                    }
                    case "restart": {
                        process.exit(1);
                    }
                }
            }
        })
    }

    private async connect() {
        //@ts-ignore
        process.send({op: "log", msg: `Cluster ${this.clusterID} | Connecting with ${this.shards} shard(s)`});

        const options = Object.assign(this.clientOptions, {autoreconnect: true, firstShardID: this.firstShardID, lastShardID: this.lastShardID, maxShards: this.shardCount});

        let App = (await import(this.path));

        let bot;
        if (App.Eris) {
            bot = new App.Eris.Client(this.token, options);
            App = App.BotWorker;
        } else {
            bot = new Eris.Client(this.token, options);
            if (App.BotWorker) {
                App = App.botWorker;
            } else {
                App = App.default ? App.default : App;
            }
        };

        this.bot = bot;

        bot.on("connect", (id: number) => {
            //@ts-ignore
            process.send({op: "log", msg: `Cluster ${this.clusterID} | Shard ${id} connected!`});
        });

        bot.on("shardDisconnect", (err: Error, id: number) => {
            //@ts-ignore
            process.send({op: "log", msg: `Cluster ${this.clusterID} | Shard ${id} disconnected!`});
        });

        bot.on("shardReady", (id: number) => {
            //@ts-ignore
            process.send({op: "log", msg: `Cluster ${this.clusterID} | Shard ${id} is ready!`});
        });

        bot.on("shardResume", (id: number) => {
            //@ts-ignore
            process.send({op: "log", msg: `Cluster ${this.clusterID} | Shard ${id} has resumed!`});
        });

        bot.on("warn", (message: string, id: number) => {
            //@ts-ignore
            process.send({ op: "error", msg: `Shard ${id} | ${message}` });
        });

        bot.on("error", (error: Error, id: number) => {
            //@ts-ignore
            process.send({ op: "error", msg: `Shard ${id} | ${inspect(error)}` });
        });

        bot.on("ready", (id: number) => {
            //@ts-ignore
            process.send({op: "log", msg: `Cluster ${this.clusterID} | Shards ${this.firstShardID} - ${this.lastShardID} are ready!`});
            //@ts-ignore
            process.send({op: "connected"});
        });

        bot.once("ready", () => {
            this.loadCode(App);
        });

        // Connects the bot
        bot.connect();
    }

    
    private async loadCode(App: any) {
        //let App = (await import(this.path)).default;
        //App = App.default ? App.default : App;
        this.app = new App({bot: this.bot, clusterID: this.clusterID, workerID: worker.id});
    }
}