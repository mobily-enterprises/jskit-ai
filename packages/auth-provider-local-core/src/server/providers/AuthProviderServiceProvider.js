class AuthProviderServiceProvider {
  static id = "auth.provider";

  static dependsOn = ["auth.provider.local"];

  register() {}
}

export { AuthProviderServiceProvider };
