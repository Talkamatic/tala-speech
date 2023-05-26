export const getAuthorizationToken = () => {
  const TOKEN_ENDPOINT =
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken";
  const azureProxyURL = null
  const azureKey = "2e15e033f605414bbbfe26cb631ab755"

  if (azureProxyURL) {
    return fetch(new Request(azureProxyURL)).then((data) =>
      data.text()
    );
  }
  return fetch(
    new Request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey!,
      },
    })
  ).then((data) => data.text());
};
