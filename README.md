# opc-ua-node-crawler
This script is build upon the node-opcua simple client and crawls an OPC UA server for all nodes. The output is a file (currently txt or json) that indicates all nodes with names and nodeIds, as well as other info.

To get the tool up and running, you will have to install nodeJS and npm. After having installed nodeJS and npm, you can do the following commands to get the tool running:

```
$ git clone https://github.com/ConstantinHildebrandt/opc-ua-node-crawler
$ cd opc-ua-node-crawler
$ npm install
$ node crawler.js --help 
$ node crawler.js -e "opc.tcp://opcua.rocks:4840" -f "json"
```
Thats it!
