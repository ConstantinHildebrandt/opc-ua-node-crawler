#!/usr/bin/env node
"use strict";

const fs = require("fs");
const treeify = require("treeify");
const _ = require("underscore");
const chalk = require("chalk");
const async = require("async");
const assert = require("node-opcua-assert").assert;
const opcua = require("node-opcua");
const VariableIds = opcua.VariableIds;



// cmd line tool
const yargs = require("yargs/yargs");
const argv = yargs(process.argv)
    .wrap(132)
    //.usage("Usage: $0 -d --endpoint <endpointUrl> [--securityMode (None|SignAndEncrypt|Sign)] [--securityPolicy (None|Basic256|Basic128Rsa15)] --node <node_id_to_monitor>")

    .demand("endpoint")
    .string("endpoint")
    .describe("endpoint", "the end point to connect to ")

    .demand("format")
    .string("format")
    .describe("format", "the file format to output: txt / json")

    .string("securityMode")
    .describe("securityMode", "the security mode")

    .string("securityPolicy")
    .describe("securityPolicy", "the policy mode")

    .string("userName")
    .describe("userName", "specify the user name of a UserNameIdentityToken ")

    .string("password")
    .describe("password", "specify the password of a UserNameIdentityToken")

    .string("node")
    .describe("node", "the nodeId of the value to monitor")

    .string("timeout")
    .describe("timeout", "the timeout of the session in second =>  (-1 for infinity)")

    .alias("e", "endpoint")
    .alias("f", "format")
    .alias("s", "securityMode")
    .alias("P", "securityPolicy")
    .alias("u", "userName")
    .alias("p", "password")
    .alias("n", "node")
    .alias("t", "timeout")

    .argv;

const securityMode = opcua.coerceMessageSecurityMode(argv.securityMode || "None");
if (!securityMode) {
    throw new Error("Invalid Security mode , should be " + opcua.MessageSecurityMode.enumItems.join(" "));
}

const securityPolicy = opcua.coerceSecurityPolicy(argv.securityPolicy || "None");
if (!securityPolicy) {
    throw new Error("Invalid securityPolicy , should be " + opcua.SecurityPolicy.enumItems.join(" "));
}

const timeout = parseInt(argv.timeout) * 1000 || 20000;

console.log(chalk.cyan("securityMode        = "), securityMode.toString());
console.log(chalk.cyan("securityPolicy      = "), securityPolicy.toString());
console.log(chalk.cyan("timeout             = "), timeout ? timeout : " Infinity ");

let client = null;
const endpointUrl = argv.endpoint;


if (!endpointUrl || !argv.format) {
    require("yargs").showHelp();
    process.exit(0);
}

let the_session = null;
let the_subscription = null;


const AttributeIds = opcua.AttributeIds;
const DataType = opcua.DataType;
const NodeCrawler = opcua.NodeCrawler;

let serverCertificate = null;

async function getBrowseName(session, nodeId) {
    const dataValue = await session.read({ nodeId: nodeId, attributeId: AttributeIds.BrowseName });
    if (dataValue.statusCode === opcua.StatusCodes.Good) {
        return dataValue.value.value.name;
    }
    return null;
}

function w(str, l) {
    return (str + "                                      ").substr(0, l);
}


async function __dumpEvent(session, fields, eventFields) {

    console.log("-----------------------");

    for (let variant of eventFields) {

        if (variant.dataType === DataType.Null) {
            continue;
        }
        if (variant.dataType === DataType.NodeId) {

            const name = await getBrowseName(session, variant.value);

            console.log(
                chalk.yellow(w(name, 20), w(fields[index], 15)),
                chalk.cyan(w(DataType[variant.dataType], 10).toString()),
                chalk.cyan.bold(name), "(", w(variant.value, 20), ")");

        } else {
            console.log(chalk.yellow(w("", 20), w(fields[index], 15)),
                chalk.cyan(w(DataType[variant.dataType], 10).toString()), variant.value);
        }
    }
}

const q = new async.queue(function (task, callback) {
    __dumpEvent(task.session, task.fields, task.eventFields, callback);
});

function dumpEvent(session, fields, eventFields, _callback) {
    q.push({
        session: session, fields: fields, eventFields: eventFields, _callback: _callback
    });

}


async.series([
    function (callback) {

        const options = {
            endpoint_must_exist: false,
            keepSessionAlive: true,
            connectionStrategy: {
                maxRetry: 10,
                initialDelay: 2000,
                maxDelay: 10 * 1000
            }
        };

        client = opcua.OPCUAClient.create(options);

        console.log(" connecting to ", chalk.cyan.bold(endpointUrl));
        console.log("    strategy", client.connectionStrategy);

        client.connect(endpointUrl, callback);

        client.on("backoff", function (number, delay) {
            console.log(chalk.bgWhite.yellow("backoff  attempt #"), number, " retrying in ", delay / 1000.0, " seconds");
        });

    },

    //------------------------------------------
    function (callback) {
        client.disconnect(callback);
    },

    // reconnect using the correct end point URL now
    function (callback) {

        const hexDump = opcua.hexDump;
        console.log(chalk.cyan("Server Certificate :"));
        console.log(chalk.yellow(hexDump(serverCertificate)));

        const options = {
            securityMode: securityMode,
            securityPolicy: securityPolicy,
            serverCertificate: serverCertificate,

            defaultSecureTokenLifetime: 40000,

            endpoint_must_exist: false,

            connectionStrategy: {
                maxRetry: 10,
                initialDelay: 2000,
                maxDelay: 10 * 1000
            }
        };
        console.log("Options = ", options.securityMode.toString(), options.securityPolicy.toString());

        client = opcua.OPCUAClient.create(options);

        console.log(" reconnecting to ", chalk.cyan.bold(endpointUrl));
        client.connect(endpointUrl, callback);
    },

    //------------------------------------------
    function (callback) {

        let userIdentity = null; // anonymous
        if (argv.userName && argv.password) {

            userIdentity = {
                userName: argv.userName,
                password: argv.password
            };

        }
        client.createSession(userIdentity, function (err, session) {
            if (!err) {
                the_session = session;
                console.log(chalk.yellow(" session created"));
                console.log(" sessionId : ", session.sessionId.toString());
            }
            callback(err);
        });
    },
    function set_event_handlers(callback) {
        client.on("connection_reestablished", function () {
            console.log(chalk.bgWhite.red(" !!!!!!!!!!!!!!!!!!!!!!!!  CONNECTION RE-ESTABLISHED !!!!!!!!!!!!!!!!!!!"));
        });
        client.on("backoff", function (number, delay) {
            console.log(chalk.bgWhite.yellow("backoff  attempt #"), number, " retrying in ", delay / 1000.0, " seconds");
        });
        client.on("start_reconnection", function () {
            console.log(chalk.bgWhite.red(" !!!!!!!!!!!!!!!!!!!!!!!!  Starting Reconnection !!!!!!!!!!!!!!!!!!!"));
        });


        callback();
    },
    // ----------------------------------------
    // display namespace array
    function (callback) {

        const server_NamespaceArray_Id = opcua.makeNodeId(VariableIds.Server_NamespaceArray); // ns=0;i=2006

        the_session.readVariableValue(server_NamespaceArray_Id, function (err, dataValue) {

            console.log(" --- NAMESPACE ARRAY ---");
            if (!err) {
                const namespaceArray = dataValue.value.value;
                for (let i = 0; i < namespaceArray.length; i++) {
                    console.log(" Namespace ", i, "  : ", namespaceArray[i]);
                }
            }
            console.log(" -----------------------");
            callback(err);
        });
    },

    // ----------------------------------------
    // crawl the object folder
    function (callback) {

        let t1, t2;

        function print_stat() {
            t2 = Date.now();
            const util = require("util");
            const str = util.format("R= %d W= %d T=%d t= %d", client.bytesRead, client.bytesWritten, client.transactionsPerformed, (t2 - t1));
            console.log(chalk.yellow(str));
        }

        assert(_.isObject(the_session));
        const crawler = new NodeCrawler(the_session);

        let t = Date.now();
        client.on("send_request", function () {
            t1 = Date.now();
        });


        // client.on("receive_response", print_stat);

        // t = Date.now();
        // crawler.on("browsed", function (element) {
        //     console.log("->", (new Date()).getTime() - t, element.browseName.name, element.nodeId.toString());
        // });

        const nodeId = "ObjectsFolder";
        console.log("now crawling object folder ...please wait...");
        crawler.read(nodeId, function (err, obj) {
            console.log(" Time        = ", (new Date()).getTime() - t);
            console.log(" read        = ", crawler.readCounter);
            console.log(" browse      = ", crawler.browseCounter);
            console.log(" transaction = ", crawler.transactionCounter);
            if (!err) {
                switch (argv.format) {
                    // case "xml":
                    //     let xmlFile = toXML.parse("OPC-UA-Object-Folder",obj);
                    //     fs.writeFileSync('log.xml', "", function (err) {
                    //         if (err) {
                    //             // append failed
                    //         } else {
                    //             // done
                    //         }
                    //     })
                    //     fs.appendFile('log.xml', xmlFile + '\n', 'utf8', function (err) {
                    //         if (err) {
                    //             // append failed
                    //         } else {
                    //             // done
                    //         }
                    //     })
                    //     break;
                    case "json":
                        fs.writeFileSync('log.json', "", function (err) {
                            if (err) {
                                // append failed
                            } else {
                                // done
                            }
                        })
                        fs.appendFile('log.json', JSON.stringify(obj) + '\n', 'utf8', function (err) {
                            if (err) {
                                // append failed
                            } else {
                                // done
                            }
                        })
                        break;
                    case "txt":
                        fs.writeFileSync('log.txt', "", function (err) {
                            if (err) {
                                // append failed
                            } else {
                                // done
                            }
                        })
                        treeify.asLines(obj, true, true, function (line) {
                            fs.appendFile('log.txt', line + '\n', function (err) {
                                if (err) {
                                    // append failed
                                } else {
                                    // done
                                }
                            })
                        });
                        break;
                    default:
                        break;
                }
            }
            client.removeListener("receive_response", print_stat);
            crawler.dispose();
            callback(err);
        });



    },

    function (callback) {
        console.log(" closing session");
        the_session.close(function (err) {
            // console.log(" session closed", err);
            callback();
        });
    },

    function (callback) {
        console.log(" Calling disconnect");
        client.disconnect(callback);
    }
], function (err) {

    console.log(chalk.cyan(" disconnected"));

    if (err) {
        console.log(chalk.red.bold(" client : process terminated with an error"));
        console.log(" error", err);
        console.log(" stack trace", err.stack);
    } else {
        console.log("success !!   ");
    }
    // force disconnection
    if (client) {
        client.disconnect(function () {
            const exit = require("exit");
            console.log("Exiting");
            exit();
        });
    }
});

process.on("error", function (err) {

    console.log(" UNTRAPPED ERROR", err.message);
});
let user_interruption_count = 0;
process.on("SIGINT", function () {

    console.log(" user interuption ...");

    user_interruption_count += 1;
    if (user_interruption_count >= 3) {
        process.exit(1);
    }
    if (the_subscription) {

        console.log(chalk.red.bold(" Received client interruption from user "));
        console.log(chalk.red.bold(" shutting down ..."));

        the_subscription.terminate(function () { });
        the_subscription = null;
    }
});