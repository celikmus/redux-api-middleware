import merge from 'lodash/merge';

const request = (path, method, body, requestOptions = {}) => {
  const jsonContentAllowed = method === 'PUT' || method === 'POST';
  const {requestHeaders, requestGateway} = requestOptions;
  const headers = Object.assign({}, requestHeaders);
  if (jsonContentAllowed && body) {
    headers['Content-Type'] = 'application/json';
  }
  const acceptsJson = method === 'GET' || method === 'POST' || method === 'OPTIONS';
  if (acceptsJson) {
    headers.Accept = 'application/json';
  }
  const gateway = (!requestGateway || requestGateway === '/') ? '' : requestGateway;
  const url = `${gateway}${path}`;
  const fetchPromise = fetch(url, {
    method,
    body,
    headers,
    credentials: 'same-origin'
  });
  return fetchPromise.then(response => {
    if (response.status >= 200 && response.status < 300) {
      return response.json().then(null, () => null);
    }
    return response.json().then(err => {
      throw err;
    });
  });
};

const creator = (options) => {
  const middleware = ({dispatch}) => next => action => {
    const {
      types,
      xhr,
      payload = {}
    } = action;

    if (!types) {
      // Normal action: pass it on
      return next(action);
    }

    if (!Array.isArray(types) ||
      types.length !== 3 ||
      !types.every(type => typeof type === 'string')
    ) {
      throw new Error('api: Expected an array of three string types.');
    }

    if ((typeof xhr !== 'object') || !xhr.url || !xhr.method) {
      throw new Error('api: Expected xhr to be an object with at least a url and a method.');
    }

    const [requestType, successType, failType] = types;

    dispatch(merge({}, {
      type: requestType,
      payload
    }));

    const method = xhr.method.toUpperCase();
    return request(xhr.url, method, xhr.data, options).then(
      response => dispatch({
        type: successType,
        payload: Object.assign({}, payload, response)
      }),
      error => {
        dispatch({
          type: failType,
          payload: Object.assign({}, payload, error)
        });
        throw error;
      });
  };
  return middleware;
}

export default creator;
