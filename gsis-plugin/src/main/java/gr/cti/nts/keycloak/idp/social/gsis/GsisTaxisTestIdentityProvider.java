/*
 * Copyright 2021 Greek School Network and Networking Technologies Directorate (http://nts.cti.gr/),
 * Konstantinos Togias (ktogias@cti.gr) and/or their affiliates and other contributors as indicated
 * by the @author tags.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

package gr.cti.nts.keycloak.idp.social.gsis;

import org.keycloak.broker.oidc.OAuth2IdentityProviderConfig;
import org.keycloak.models.KeycloakSession;

public class GsisTaxisTestIdentityProvider extends GsisAbstractIdentityProvider {

  // INTRAWAY: the pilot endpoints can be redirected to a local mock GSIS server for development.
  // GSIS_TEST_URL is used by the browser (authorize, logout), GSIS_TEST_BACKCHANNEL_URL by Keycloak
  // itself (token, userinfo; defaults to GSIS_TEST_URL). Unset = the real test.gsis.gr.
  // Only the test provider honours these; the production provider stays hardcoded.
  private static final String FRONT_BASE = env("GSIS_TEST_URL", "https://test.gsis.gr/oauth2server");

  private static final String BACK_BASE = env("GSIS_TEST_BACKCHANNEL_URL", FRONT_BASE);

  public static final String AUTH_URL = FRONT_BASE + "/oauth/authorize";

  public static final String TOKEN_URL = BACK_BASE + "/oauth/token";

  public static final String DEFAULT_SCOPE = "";

  private static final String USER_INFO_URL = BACK_BASE + "/userinfo?format=xml";

  private static final String LOGOUT_URL = FRONT_BASE + "/logout/{clientId}/";

  private static String env(String name, String fallback) {
    String value = System.getenv(name);
    return value == null || value.isBlank() ? fallback : value.replaceAll("/+$", "");
  }

  public GsisTaxisTestIdentityProvider(KeycloakSession session,
      OAuth2IdentityProviderConfig config) {
    super(session, config);
  }

  @Override
  protected String getAuthUrl() {
    return AUTH_URL;
  }

  @Override
  protected String getTokenUrl() {
    return TOKEN_URL;
  }

  @Override
  protected String getDefaultScope() {
    return DEFAULT_SCOPE;
  }

  @Override
  protected String getUserInfoUrl() {
    return USER_INFO_URL;
  }

  @Override
  protected String getLogoutUrl() {
    return LOGOUT_URL;
  }
}
