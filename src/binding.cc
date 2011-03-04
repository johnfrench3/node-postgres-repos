#include <libpq-fe.h>
#include <node.h>
#include <node_events.h>
#include <string.h>
#include <assert.h>
#include <stdlib.h>

#define LOG(msg) printf("%s\n",msg)
#define TRACE(msg) //printf("%s\n", msg);


#define THROW(msg) return ThrowException(Exception::Error(String::New(msg)));

using namespace v8;
using namespace node;

static Persistent<String> connect_symbol;
static Persistent<String> error_symbol;
static Persistent<String> ready_symbol;
static Persistent<String> row_symbol;
static Persistent<String> notice_symbol;

class Connection : public EventEmitter {

public:

  //creates the V8 objects & attaches them to the module (target)
  static void
  Init (Handle<Object> target)
  {
    HandleScope scope;
    Local<FunctionTemplate> t = FunctionTemplate::New(New);

    t->Inherit(EventEmitter::constructor_template);
    t->InstanceTemplate()->SetInternalFieldCount(1);
    t->SetClassName(String::NewSymbol("Connection"));

    connect_symbol = NODE_PSYMBOL("connect");
    error_symbol = NODE_PSYMBOL("_error");
    ready_symbol = NODE_PSYMBOL("_readyForQuery");
    notice_symbol = NODE_PSYMBOL("notice");
    row_symbol = NODE_PSYMBOL("_row");

    NODE_SET_PROTOTYPE_METHOD(t, "connect", Connect);
    NODE_SET_PROTOTYPE_METHOD(t, "_sendQuery", SendQuery);
    NODE_SET_PROTOTYPE_METHOD(t, "_sendQueryWithParams", SendQueryWithParams);
    NODE_SET_PROTOTYPE_METHOD(t, "end", End);

    target->Set(String::NewSymbol("Connection"), t->GetFunction());
    TRACE("created class");
  }

  //static function called by libev as callback entrypoint
  static void
  io_event(EV_P_ ev_io *w, int revents)
  {
    TRACE("Received IO event");
    Connection *connection = static_cast<Connection*>(w->data);
    connection->HandleIOEvent(revents);
  }

  //v8 entry point into Connection#connect
  static Handle<Value>
  Connect(const Arguments& args)
  {
    HandleScope scope;
    Connection *self = ObjectWrap::Unwrap<Connection>(args.This());
    if(args.Length() == 0 || !args[0]->IsString()) {
      THROW("Must include connection string as only argument to connect");
    }

    String::Utf8Value conninfo(args[0]->ToString());
    self->Connect(*conninfo);

    return Undefined();
  }

  //v8 entry point into Connection#_sendQuery
  static Handle<Value>
  SendQuery(const Arguments& args)
  {
    HandleScope scope;
    Connection *self = ObjectWrap::Unwrap<Connection>(args.This());
    if(!args[0]->IsString()) {
      return ThrowException(Exception::Error(String::New("First parameter must be a string query")));
    }

    char* queryText = MallocCString(args[0]);
    int result = self->Send(queryText);
    free(queryText);
    if(result == 0) {
      THROW("PQsendQuery returned error code");
    }
    //TODO should we flush before throw?
    self->Flush();
    return Undefined();
  }

  //v8 entry point into Connection#_sendQueryWithParams
  static Handle<Value>
  SendQueryWithParams(const Arguments& args)
  {
    HandleScope scope;
    Connection *self = ObjectWrap::Unwrap<Connection>(args.This());
    if(!args[0]->IsString()) {
      return ThrowException(Exception::Error(String::New("First parameter must be a string query")));
    }

    if(!args[1]->IsArray()) {
      return ThrowException(Exception::Error(String::New("Values must be array")));
    }

    char* queryText = MallocCString(args[0]);
    Local<Array> params = Local<Array>::Cast(args[1]);
    int len = params->Length();
    char* *paramValues = new char*[len];
    for(int i = 0; i < len; i++) {
      Handle<Value> val = params->Get(i);
      if(!val->IsString()) {
        //TODO this leaks mem
        delete [] paramValues;
        return ThrowException(Exception::Error(String::New("Only string parameters supported")));
      }
      char* cString = MallocCString(val);
      paramValues[i] = cString;
    }

    int result = self->SendQueryParams(queryText, len, paramValues);

    free(queryText);
    for(int i = 0; i < len; i++) {
      free(paramValues[i]);
    }
    delete [] paramValues;
    if(result == 1) {
      return Undefined();
    }
    return ThrowException(Exception::Error(String::New("Could not dispatch parameterized query")));
  }

  static char* MallocCString(v8::Handle<Value> v8String)
  {
    String::Utf8Value utf8String(v8String->ToString());
    char *cString = (char *) malloc(strlen(*utf8String) + 1);
    strcpy(cString, *utf8String);
    return cString;
  }

  //v8 entry point into Connection#end
  static Handle<Value>
  End(const Arguments& args)
  {
    HandleScope scope;

    Connection *self = ObjectWrap::Unwrap<Connection>(args.This());

    self->End();
    return Undefined();
  }

  ev_io read_watcher_;
  ev_io write_watcher_;
  PGconn *connection_;
  bool connecting_;
  Connection () : EventEmitter ()
  {
    connection_ = NULL;
    connecting_ = false;

    TRACE("Initializing ev watchers");
    ev_init(&read_watcher_, io_event);
    read_watcher_.data = this;
    ev_init(&write_watcher_, io_event);
    write_watcher_.data = this;
  }

  ~Connection ()
  {
  }

protected:

  //v8 entry point to constructor
  static Handle<Value>
  New (const Arguments& args)
  {
    HandleScope scope;
    Connection *connection = new Connection();
    connection->Wrap(args.This());

    return args.This();
  }

  int Send(const char *queryText)
  {
    return PQsendQuery(connection_, queryText);
  }

  int SendQueryParams(const char *command, const int nParams, const char * const *paramValues)
  {
    return PQsendQueryParams(connection_, command, nParams, NULL, paramValues, NULL, NULL, 0);
  }

  //flushes socket
  void Flush()
  {
    if(PQflush(connection_) == 1) {
      TRACE("Flushing");
      ev_io_start(EV_DEFAULT_ &write_watcher_);
    }
  }

  //initializes initial async connection to postgres via libpq
  //and hands off control to libev
  bool Connect(const char* conninfo)
  {
    connection_ = PQconnectStart(conninfo);

    if (!connection_) {
      LOG("Connection couldn't be created");
    } else {
      TRACE("Native connection created");
    }

    if (PQsetnonblocking(connection_, 1) == -1) {
      LOG("Unable to set connection to non-blocking");
      PQfinish(connection_);
      connection_ = NULL;
    }

    ConnStatusType status = PQstatus(connection_);

    if(CONNECTION_BAD == status) {
      PQfinish(connection_);
      LOG("Bad connection status");
      connection_ = NULL;
    }

    int fd = PQsocket(connection_);
    if(fd < 0) {
      LOG("socket fd was negative. error");
      return false;
    }

    assert(PQisnonblocking(connection_));

    PQsetNoticeProcessor(connection_, NoticeReceiver, this);

    TRACE("Setting watchers to socket");
    ev_io_set(&read_watcher_, fd, EV_READ);
    ev_io_set(&write_watcher_, fd, EV_WRITE);

    connecting_ = true;
    StartWrite();

    Ref();
    return true;
  }

  static void NoticeReceiver(void *arg, const char *message)
  {
    Connection *self = (Connection*)arg;
    self->HandleNotice(message);
  }

  void HandleNotice(const char *message)
  {
    HandleScope scope;
    Handle<Value> notice = String::New(message);
    Emit(notice_symbol, 1, &notice);
  }

  //called to process io_events from libev
  void HandleIOEvent(int revents)
  {
    if(revents & EV_ERROR) {
      LOG("Connection error.");
      return;
    }

    if(connecting_) {
      TRACE("Processing connecting_ io");
      HandleConnectionIO();
      return;
    }

    if(revents & EV_READ) {
      TRACE("revents & EV_READ");
      if(PQconsumeInput(connection_) == 0) {
        LOG("Something happened, consume input is 0");
        return;
      }

      //declare handlescope as this method is entered via a libev callback
      //and not part of the public v8 interface
      HandleScope scope;

      if (PQisBusy(connection_) == 0) {
        PGresult *result;
        bool didHandleResult = false;
        while ((result = PQgetResult(connection_))) {
          HandleResult(result);
          didHandleResult = true;
          PQclear(result);
        }
        if(didHandleResult) {
          //might have fired from notification
          Emit(ready_symbol, 0, NULL);
        }
      }

      //TODO look at this later
      PGnotify *notify;
      while ((notify = PQnotifies(connection_))) {
        Local<Object> result = Object::New();
        result->Set(String::New("channel"), String::New(notify->relname));
        Handle<Value> res = (Handle<Value>)result;
        Emit((Handle<String>)String::New("notification"), 1, &res);
        PQfreemem(notify);
      }

    }

    if(revents & EV_WRITE) {
      TRACE("revents & EV_WRITE");
      if (PQflush(connection_) == 0) {
        StopWrite();
      }
    }
  }

  void HandleResult(PGresult* result)
  {
    ExecStatusType status = PQresultStatus(result);
    switch(status) {
    case PGRES_TUPLES_OK:
      HandleTuplesResult(result);
      break;
    case PGRES_FATAL_ERROR:
      EmitLastError();
      break;
    case PGRES_COMMAND_OK:
    case PGRES_EMPTY_QUERY:
      //do nothing
      break;
    default:
      printf("Unrecogized query status: %s\n", PQresStatus(status));
      break;
    }
  }

  void HandleTuplesResult(PGresult* result)
  {
    int rowCount = PQntuples(result);
    for(int rowNumber = 0; rowNumber < rowCount; rowNumber++) {
      //create result object for this row
      Local<Array> row = Array::New();
      int fieldCount = PQnfields(result);
      for(int fieldNumber = 0; fieldNumber < fieldCount; fieldNumber++) {
        Local<Object> field = Object::New();
        char* fieldName = PQfname(result, fieldNumber);
        int fieldType = PQftype(result, fieldNumber);
        char* fieldValue = PQgetvalue(result, rowNumber, fieldNumber);
        //TODO use symbols here
        field->Set(String::New("name"), String::New(fieldName));
        field->Set(String::New("value"), String::New(fieldValue));
        field->Set(String::New("type"), Integer::New(fieldType));
        row->Set(Integer::New(fieldNumber), field);
      }

      //not sure about what to dealloc or scope#Close here
      Handle<Value> e = (Handle<Value>)row;
      Emit(row_symbol, 1, &e);
    }
  }

  Handle<Value> WrapFieldValue(PGresult* result, int rowNumber, int fieldNumber)
  {
    int fieldType = PQftype(result, fieldNumber);
    char* fieldValue = PQgetvalue(result, rowNumber, fieldNumber);
    switch(fieldType) {
    case 23:
      return Integer::New(atoi(fieldValue));
    default:
      return String::New(fieldValue);
    }
  }

  void End()
  {
    StopRead();
    StopWrite();
    PQfinish(connection_);
  }

private:
  void HandleConnectionIO()
  {
    PostgresPollingStatusType status = PQconnectPoll(connection_);
    switch(status) {
    case PGRES_POLLING_READING:
      TRACE("Polled: PGRES_POLLING_READING");
      StopWrite();
      StartRead();
      break;
    case PGRES_POLLING_WRITING:
      TRACE("Polled: PGRES_POLLING_WRITING");
      StopRead();
      StartWrite();
      break;
    case PGRES_POLLING_FAILED:
      StopRead();
      StopWrite();
      TRACE("Polled: PGRES_POLLING_FAILED");
      EmitLastError();
      break;
    case PGRES_POLLING_OK:
      TRACE("Polled: PGRES_POLLING_OK");
      connecting_ = false;
      StartRead();
      Emit(connect_symbol, 0, NULL);
    default:
      //printf("Unknown polling status: %d\n", status);
      break;
    }
  }

  void EmitError(const char *message)
  {
    Local<Value> exception = Exception::Error(String::New(message));
    Emit(error_symbol, 1, &exception);
  }

  void EmitLastError()
  {
    EmitError(PQerrorMessage(connection_));
  }

  void StopWrite()
  {
    TRACE("Stoping write watcher");
    ev_io_stop(EV_DEFAULT_ &write_watcher_);
  }

  void StartWrite()
  {
    TRACE("Starting write watcher");
    ev_io_start(EV_DEFAULT_ &write_watcher_);
  }

  void StopRead()
  {
    TRACE("Stoping read watcher");
    ev_io_stop(EV_DEFAULT_ &read_watcher_);
  }

  void StartRead()
  {
    TRACE("Starting read watcher");
    ev_io_start(EV_DEFAULT_ &read_watcher_);
  }

};

extern "C" void
init (Handle<Object> target)
{
  HandleScope scope;
  Connection::Init(target);
}
