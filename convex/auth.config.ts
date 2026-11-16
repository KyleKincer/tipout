// Convex accepts the Clerk "convex" JWT from the same production Clerk instance the app signs in with.
// CLERK_JWT_ISSUER_DOMAIN is set on each Convex deployment (https://clerk.tipout.kylekincer.com in production).
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: 'convex',
    },
  ],
}

export default authConfig
