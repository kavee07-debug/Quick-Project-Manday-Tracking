namespace Qtm.Api.Auth;

/// <summary>Authentication scheme names. The app's own JWT is the default Bearer scheme;
/// "EntraId" is a second scheme used only to validate Microsoft tokens at /auth/ms-login.</summary>
public static class AuthSchemes
{
    public const string EntraId = "EntraId";
}
