class AuthProviderServiceProvider {
  static id = "auth.provider";

  static dependsOn = ["auth.provider.supabase"];

  register() {}
}

export { AuthProviderServiceProvider };
