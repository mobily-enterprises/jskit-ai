// A Google OAuth scope's full URL; a scope already given as a URL is kept.
const googleScope = (name) => name.startsWith("https:") ? name : `https://www.googleapis.com/auth/${name}`;

export { googleScope };
