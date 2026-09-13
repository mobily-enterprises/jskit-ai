# AWS credentials and ownership

S3 and Athena use AWS Signature Version 4, implemented by the official AWS SDK.
The shared runtime resolves explicit credential references for each operation.
It never falls back to environment names, AWS profiles, instance metadata or the
machine operator's account. CLI and Vibe64 use the same configuration and file
connection store. This is useful library code; provisioning remains host work.

## Create or obtain credentials

Prefer temporary role credentials. An administrator supplies a role with the
resource permissions listed in the provider guide; an authorized host can use
[STS AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)
to obtain access key ID, secret access key and session token. Trust policies,
external IDs for third-party access, MFA requirements and expiration belong to
that setup. This fragment accepts the resulting three bindings; it does not
assume roles or refresh STS credentials itself. The resolver must return a
consistent credential set and renew it before expiration.

For a deliberately selected IAM-user key:

1. Sign into the AWS console as that IAM user, in the intended account.
2. Open your account menu at the top right, then **Security credentials**.
3. Under **Access keys**, choose **Create access key**. Review the alternatives.
4. If a long-lived key is appropriate, select **Other**, then **Next**.
5. Add a description identifying this application and environment. Choose
   **Create access key**.
6. On **Retrieve access keys**, save the ID and secret into the backend's secret
   environment. AWS reveals the secret only at creation. Choose **Done**.
7. Put references such as `env:AWS_ACCESS_KEY_ID` and
   `env:AWS_SECRET_ACCESS_KEY` in the integration configuration. Leave the
   optional session-token reference absent for long-lived IAM-user keys.

These are AWS's [documented console steps](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html).
Use an IAM identity restricted to the intended resources, not an account root key.
Account enrollment, billing and administrator access are prerequisites; adding
an integration does not create an AWS account or confer administrator rights.

## Online, public editor and independent CLI

There is **no OAuth registration, redirect URI or universal callback URL** for
these credential modes. The app's VPS and custom domain do not change the AWS
account, region or identity. Browser S3 access can require a CORS update when the
app changes domain; server-side Athena calls do not use browser CORS.

The application owner supplies the AWS identity and resource set. CLI and editor
configuration use the same application-owned Env bindings. Hosted and installed
editors do not supply shared AWS credentials. Two access keys or roles in one
account do not create separate quota pools.

After saving the configuration, Vibe64 provides a **Set credential in Env**
link for the access key ID, secret access key and any configured session token.
Each link opens that project's Env screen with the referenced variable name.
Only references are saved in the integration file. Clearing the optional token
reference removes its shortcut; it does not delete the existing Env value.

AWS's [Athena quota documentation](https://docs.aws.amazon.com/athena/latest/ug/service-limits.html)
explicitly shares service quotas across an account's workgroups. Separate
workgroups are useful for policies and query limits; they do not isolate account
capacity. Account and role provisioning are operator responsibilities, separate
from these runtime adapters.

## Can an AI automate setup?

With explicitly authorized administrative credentials, an AI can compose and
apply resource policies, create service resources, and call
[CreateAccessKey](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateAccessKey.html)
for an existing IAM user. Secret output must be captured directly into the
chosen secret store. Resource creation and policy changes are separate from
runtime verification; these adapters never perform them on Connect.

An AI cannot bootstrap trust or permissions that the owner has not granted.
The current package includes guidance and runtime operations, not an automated
AWS account factory, IAM policy deployment or STS renewal service. Follow the
[S3](aws-s3.md) or [Athena](aws-athena.md) setup for the actual resources.
