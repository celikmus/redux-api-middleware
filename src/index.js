import merge from 'lodash/merge';
import {normalize} from 'normalizr';

const request = (path, method, body, requestOptions = {}) => {
  const {requestHeaders, requestGateway} = requestOptions;
  const headers = Object.assign({}, requestHeaders);

  const jsonContentAllowed = method === 'PUT' || method === 'POST';
  if (jsonContentAllowed && body) {
    headers['Content-Type'] = 'application/json';
  }

  const acceptsJson = method === 'GET' || method === 'POST' || method === 'OPTIONS';
  if (acceptsJson) {
    headers.Accept = 'application/json';
  }

  const gateway = (!requestGateway || requestGateway === '/') ? '' : requestGateway;
  const url = `${gateway}${path}`;

  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (let header in headers) {
      xhr.setRequestHeader(header, headers[header]);
    }
    xhr.withCredentials = true;
    xhr.onload = () => {
      const {status, statusText, response} = xhr;
      if (status >= 200 && status < 300) {
        resolve(JSON.parse(response));
      } else {
        throw statusText;
      }
    };
    xhr.send(body);
  });
};

const creator = (options) => {
  const middleware = ({dispatch, getState}) => next => action => {
    const {
      types,
      schema,
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
    return request(xhr.url, method, xhr.data, options)
    .then(response => {
      if (!schema) {
        dispatch({
          type: successType,
          payload: Object.assign({}, payload, response)
        });
      } else {
        // Normalise response
        const state = getState();
        if (method.toUpperCase() === 'DELETE') {
          const urlParts = xhr.url.split('/');
          const entityId = urlParts[urlParts.length - 1];
          const collection = schema.getKey();
          state.entities[collection][entityId] = null;
          dispatch(Object.assign({}, {
            type: successType
          }));
        } else {
          let updatedResponse = response;
          let isCollection = Array.isArray(response);
          let hasPayload = !!Object.entries(payload).length;
          if (hasPayload) {
            // Does response item/collection have sub collections?
            // If it does have sub collections, we need to link the entity to those collections,
            // ie. subcollections need to have the id of this entity, ie. the entity they belong to.
            //
            // itemId, ie. key for subcollections, must be specified in the schema:
            // e.g.
            // let's say our current entity is 'hotel' with id: 'XYZ',
            // and 'hotel' entity has 'rooms' subcollection on it.
            // The schemas for 'hotel' and 'room' entities will look like below:
            //
            // const hotelSchema = new Schema('hotels');
            // const roomSchema = new Schema('rooms');
            // hotelSchema.define({
            //   rooms: arrayOf(roomSchema),
            //   itemId: 'hotelId' // key to populate in rooms
            // });
            //
            // When the above schema setup is processed by the middleware here,
            // the middleware will add hotelId: 'XYZ' to each zone entry in the 'rooms' subcollection.
            let itemSchema = schema.getItemSchema ? schema.getItemSchema() : schema;
            let itemKey = itemSchema.itemId;
            let sampleItem = isCollection ? response[0] || {} : response;
            // Get collection props
            const arrayProps = Object.keys(sampleItem).filter(prop => Array.isArray(sampleItem[prop]));
            // Insert itemId in sub collection...
            if (isCollection) {
              arrayProps.forEach(prop => {
                if (itemSchema[prop]) {
                  response.forEach((item) => {
                    item[prop] = item[prop].map((subItem) => merge({}, subItem, { [itemKey]: item.id }));
                  });
                }
              });
              updatedResponse = response.map(entry => Object.assign({}, entry, payload));
            } else {
              arrayProps.forEach(prop => {
                if (itemSchema[prop]) {
                  response[prop] = response[prop].map((subItem) => merge({}, subItem, { [itemKey]: response.id }));
                }
              });
              updatedResponse = Object.assign({}, response, payload);
            }
          }
          dispatch({
            type: successType,
            payload: normalize(updatedResponse, schema)
          });
        }
      }
    })
    .catch(
        error => {
          dispatch({
            type: failType,
            payload: Object.assign({}, payload, error)
          });
          throw error;
        }
      );
  };
  return middleware;
}

export default creator;
