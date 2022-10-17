import { CloudFormation } from "@aws-sdk/client-cloudformation";
import { Lambda } from "@aws-sdk/client-lambda";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cf = new CloudFormation({
  region: process.env.AWS_REGION || "us-east-1",
  retryMode: "adaptive",
});

const l = new Lambda({
  region: "us-east-1",
  retryMode: "adaptive",
});

const results = [];

(async () => {
  console.log("listing stacks..");
  const listStacksResult = await cf.listStacks({});

  for (const stack of listStacksResult.StackSummaries) {
    if (stack.StackStatus === "DELETE_COMPLETE") {
      continue;
    }

    // Dumb way to deal with rate limits but whatever
    await sleep(250);

    const resources = await cf.describeStackResources({
      StackName: stack.StackName,
    });

    resources.StackResources?.filter(
      ({ ResourceType }) => ResourceType === "AWS::Lambda::Function"
    ).forEach(async (r) => {
      await sleep(250);

      const { Runtime } = await l.getFunctionConfiguration({
        FunctionName: r.PhysicalResourceId,
      });

      if (Runtime && !["nodejs14.x", "nodejs16.x"].includes(Runtime)) {
        results.push({
          stack: stack.StackName,
          functionName: r.PhysicalResourceId,
          runtime: Runtime,
        });
      }
    });
  }

  if (results.length === 0) {
    console.log("all functions up to date");
    process.exit(0);
  }

  console.table(results);
})();
