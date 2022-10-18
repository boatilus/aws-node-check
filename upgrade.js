"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @file
 *
 * Upgrades CloudFormation templates to use the Node runtime if the runtime is <
 * nodejs14.x. The caller must have permission to run cloudformation:GetTemplate
 * and cloudformation:UpdateStack.
 *
 * Usage is via environment variables:
 *
 * - STACKS: a comma-separated list of stacks to update
 * - NODE_VERSION: the version to upgrade to [defaults to nodejs14.x]
 */
const client_cloudformation_1 = require("@aws-sdk/client-cloudformation");
const path = __importStar(require("path"));
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
/** The Node version to update functions to. */
const nodeVersion = process.env.NODE_VERSION || "nodejs14.x";
const cf = new client_cloudformation_1.CloudFormation({
    region: process.env.AWS_REGION || "us-east-1",
});
const stacks = process.env.STACKS;
if (!stacks || stacks.split(",").length === 0) {
    console.error("$STACKS unspecified or not a comma-separated list");
    process.exit(1);
}
/**
 * Update a given stack's Node functions to the Node version specified by
 * `process.env.NODE_VERSION`
 *
 * @returns The HTTP status code for the update request.
 * @throws On any failure.
 */
const updateStackNodeVersion = async (stackName) => {
    let updateRequired = false;
    const { TemplateBody } = await cf.getTemplate({
        StackName: stackName,
    });
    if (!TemplateBody) {
        throw Error("template body is empty");
    }
    const backupPath = path.join(process.cwd(), "backup");
    if (!(0, fs_1.existsSync)(backupPath)) {
        await (0, promises_1.mkdir)(backupPath);
    }
    // Back up the existing template -- just in case.
    await (0, promises_1.writeFile)(path.join(backupPath, `${stackName}-${new Date().toISOString()}.json`), TemplateBody);
    const obj = JSON.parse(TemplateBody);
    if (Object.keys(obj.Resources).length === 0) {
        throw Error("resource count is 0");
    }
    for (const prop in obj.Resources) {
        const { FunctionName, Runtime } = obj.Resources[prop]
            .Properties;
        if (obj.Resources[prop].Type === "AWS::Lambda::Function") {
            if (Runtime.startsWith("nodejs") &&
                !["nodejs14.x", "nodejs16.x"].includes(Runtime)) {
                updateRequired = true;
                console.log(`updating ${FunctionName || "unnamed function"} to ${nodeVersion}`);
                obj.Resources[prop].Properties.Runtime = nodeVersion;
            }
            else {
                console.log(`runtime for ${FunctionName || "unnamed function"} already up to date at ${Runtime}`);
            }
        }
    }
    if (!updateRequired) {
        return -1;
    }
    const newTemplate = JSON.stringify(obj, null, 2);
    const updateOutput = await cf.updateStack({
        StackName: stackName,
        TemplateBody: newTemplate,
        Capabilities: ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"],
    });
    return updateOutput.$metadata.httpStatusCode;
};
(async function () {
    for (const stack of stacks.split(",")) {
        try {
            const statusCode = await updateStackNodeVersion(stack);
            if (statusCode === -1) {
                console.log("no stack update required");
                continue;
            }
            console.log(`update stack '${stack}': ${statusCode}`);
        }
        catch (err) {
            if (err instanceof client_cloudformation_1.CloudFormationServiceException) {
                if (err.message.endsWith("does not exist")) {
                    console.log(`skipping '${stack}'; does not exist in account..`);
                    continue;
                }
                else if (err.message.endsWith("are to be performed.")) {
                    console.log(`skipping '${stack}'; already up to date..`);
                    continue;
                }
                else {
                    console.error(err.message);
                }
            }
            console.error(err);
        }
    }
})();
